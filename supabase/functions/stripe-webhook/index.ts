/**
 * Stripe webhook handler.
 *
 * Security/integrity boundary:
 *   1. verify Stripe's signature against the unmodified request body;
 *   2. claim the event with a database lease;
 *   3. verify the latest Checkout Session is settled in EUR;
 *   4. commit fulfillment through one PostgreSQL transaction;
 *   5. acknowledge only after the durable business state is complete.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.4.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  extendCheckoutReservationForAsyncPayment,
  finalizeGiftCardFromStripe,
  finalizeOrderFromStripe,
  getUserEmail,
  loadPendingCheckout,
  recordCheckoutLegalAcceptance,
  releaseCheckoutReservation,
} from "../_shared/fulfillment.ts";
import {
  escapeTelegramHtml,
  getStripe,
  isStripeEventModeAllowed,
} from "../_shared/payment.ts";
import {
  sendGiftCardEmailTo,
  sendOrderConfirmationEmail,
} from "../_shared/email.ts";

const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID") || "";

function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("Supabase service configuration is missing");
  }
  return createClient(url, serviceKey);
}

async function claimEvent(supabaseAdmin: any, event: Stripe.Event): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("claim_stripe_webhook_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_stripe_created: event.created
      ? new Date(event.created * 1000).toISOString()
      : null,
  });

  if (error) {
    throw new Error(`Stripe event claim failed: ${error.message}`);
  }
  return data === true;
}

async function completeEvent(
  supabaseAdmin: any,
  eventId: string,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("complete_stripe_webhook_event", {
    p_event_id: eventId,
    p_success: success,
    p_error: errorMessage || null,
  });
  if (error) {
    throw new Error(`Stripe event completion failed: ${error.message}`);
  }
}

async function sendTelegramNotification(message: string): Promise<void> {
  if (!telegramBotToken || !telegramChatId) return;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: message,
          parse_mode: "HTML",
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (!response.ok) {
      console.error("Telegram notification failed with status", response.status);
    }
  } catch (error) {
    console.error(
      "Telegram notification failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

async function notifyOrder(
  supabaseAdmin: any,
  result: Awaited<ReturnType<typeof finalizeOrderFromStripe>>,
): Promise<void> {
  const order = result.order as any;
  const userId = order.user_id as string | undefined;

  if (userId) {
    try {
      const email = await getUserEmail(supabaseAdmin, userId);
      if (email) {
        const sent = await sendOrderConfirmationEmail(email, order);
        if (!sent) console.error("Order confirmation email was not accepted");
      }
    } catch (error) {
      console.error(
        "Order email notification failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  const shortages = (result.inventory as any)?.shortages;
  const shortageText = Array.isArray(shortages) && shortages.length > 0
    ? `\n⚠️ Carenze stock: ${shortages.length}`
    : "";

  if (result.created) {
    await sendTelegramNotification(
      `🛒 <b>NUOVO ORDINE</b>\n\n` +
        `📦 <b>Ordine:</b> #${escapeTelegramHtml(order.order_number)}\n` +
        `💰 <b>Totale:</b> €${Number(order.total || 0).toFixed(2)}` +
        shortageText,
    );
  }
}

async function notifyGiftCard(
  result: Awaited<ReturnType<typeof finalizeGiftCardFromStripe>>,
): Promise<void> {
  const giftCard = result.giftCard as any;

  if (giftCard.recipient_email) {
    const sent = await sendGiftCardEmailTo(giftCard).catch((error) => {
      console.error(
        "Gift-card delivery email failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      return false;
    });
    if (!sent) console.error("Gift-card delivery email was not accepted");
  }

  // Never copy the stored-value bearer code or recipient address to Telegram.
  if (result.created) {
    await sendTelegramNotification(
      `🎁 <b>NUOVA GIFT CARD</b>\n\n` +
        `💰 <b>Importo:</b> €${Number(giftCard.amount || 0).toFixed(2)}\n` +
        `✅ Pagamento Stripe completato`,
    );
  }
}

async function retrieveCheckoutSession(
  stripe: Stripe,
  id: string,
): Promise<Stripe.Checkout.Session> {
  return await stripe.checkout.sessions.retrieve(id, {
    expand: ["payment_intent"],
  });
}

async function fulfillCheckoutSession(
  supabaseAdmin: any,
  stripe: Stripe,
  eventSession: Stripe.Checkout.Session,
): Promise<void> {
  const session = await retrieveCheckoutSession(stripe, eventSession.id);
  const pending = await loadPendingCheckout(supabaseAdmin, session.id);

  // checkout.session.completed can be unpaid for delayed methods. Stripe sends
  // checkout.session.async_payment_succeeded once funds are available. A
  // zero-value order covered by internal value is legitimately marked
  // no_payment_required and has no PaymentIntent.
  if (
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    // Gift-card purchases do not reserve stock or internal value. Physical
    // orders do, and that reservation must outlive delayed settlement.
    if (pending.checkout_type === "order") {
      await extendCheckoutReservationForAsyncPayment(
        supabaseAdmin,
        session.id,
      );
    }
    return;
  }

  await recordCheckoutLegalAcceptance(supabaseAdmin, session);

  if (pending.checkout_type === "gift_card") {
    const result = await finalizeGiftCardFromStripe(supabaseAdmin, session);
    await notifyGiftCard(result);
    return;
  }

  const result = await finalizeOrderFromStripe(supabaseAdmin, session);
  await notifyOrder(supabaseAdmin, result);
}

async function processFullRefund(
  supabaseAdmin: any,
  charge: Stripe.Charge,
): Promise<void> {
  if (!charge.refunded) {
    await processPartialRefund(supabaseAdmin, charge);
    return;
  }

  const paymentIntent = charge.payment_intent;
  const paymentId = typeof paymentIntent === "string"
    ? paymentIntent
    : paymentIntent?.id;
  if (!paymentId) {
    throw new Error("Refunded charge has no PaymentIntent");
  }

  const { data, error } = await supabaseAdmin.rpc("refund_paid_order", {
    p_payment_id: paymentId,
  });
  if (error || !data?.success) {
    throw new Error(
      `Atomic refund reconciliation failed: ${error?.message || data?.reason || "unknown error"}`,
    );
  }

  await sendTelegramNotification(
    `↩️ <b>RIMBORSO COMPLETO RICONCILIATO</b>\n\n` +
      `Ordine interno: ${escapeTelegramHtml(data.order_id || "non trovato")}`,
  );
}

/**
 * Partial refunds cannot be auto-allocated between cash, credits, gift-card
 * value and line items without a business decision. They are still recorded:
 * the order moves to partially_refunded and operations get an alert, so no
 * refund can silently disappear from bookkeeping anymore.
 */
async function processPartialRefund(
  supabaseAdmin: any,
  charge: Stripe.Charge,
): Promise<void> {
  const paymentIntent = charge.payment_intent;
  const paymentId = typeof paymentIntent === "string"
    ? paymentIntent
    : paymentIntent?.id;
  if (!paymentId) return;

  const refundedCents = Number(charge.amount_refunded || 0);
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, status, payment_status, total")
    .eq("payment_id", paymentId)
    .maybeSingle();

  if (!order) {
    // Unknown internal order (gift cards have no orders row): alert only.
    await sendTelegramNotification(
      `⚠️ <b>PARZIALE NON ALLOCABILE</b>\n` +
        `Rimborso parziale €${(refundedCents / 100).toFixed(2)} su pagamento senza ordine collegato.\n` +
        `Richiede allocazione manuale.`,
    );
    return;
  }

  if (order.payment_status === "refunded" || order.status === "refunded") {
    // A full refund was already reconciled for this payment.
    return;
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      payment_status: "partially_refunded",
      status: order.status === "cancelled" || order.status === "refunded"
        ? order.status
        : "partially_refunded",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (error) {
    throw new Error(`Partial refund status update failed: ${error.message}`);
  }

  await sendTelegramNotification(
    `🟠 <b>RIMBORSO PARZIALE REGISTRATO</b>\n` +
      `📦 Ordine: ${escapeTelegramHtml(order.order_number || String(order.id))}\n` +
      `💰 Rimborsato finora: €${(refundedCents / 100).toFixed(2)} di €${Number(order.total || 0).toFixed(2)}\n` +
      `⚠️ Stock e crediti NON ripristinati: richiede valutazione manuale.`,
  );
}

/**
 * Chargebacks must never be invisible to operations. dispute.created marks the
 * order; dispute.closed records the outcome. Funds evidence stays in Stripe.
 */
async function processDispute(
  supabaseAdmin: any,
  dispute: Stripe.Dispute,
): Promise<void> {
  const paymentIntentId = typeof dispute.payment_intent === "string"
    ? dispute.payment_intent
    : dispute.payment_intent?.id;
  if (!paymentIntentId) return;

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, status, payment_status")
    .eq("payment_id", paymentIntentId)
    .maybeSingle();
  if (!order) return;

  if (dispute.status === "lost" || dispute.status === "warning_closed") {
    // Lost disputes are money out of the door: reconcile as a refund so stock,
    // credits and referral rewards follow the same compensation path.
    const { data, error } = await supabaseAdmin.rpc("refund_paid_order", {
      p_payment_id: paymentIntentId,
    });
    if (!error && data?.success) {
      await supabaseAdmin
        .from("orders")
        .update({
          status: "disputed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      await sendTelegramNotification(
        `❌ <b>DISPUTE PERSA → RICONCILIATA</b>\n` +
          `📦 Ordine: ${escapeTelegramHtml(order.order_number || String(order.id))}\n` +
          `Stock/crediti ripristinati via refund_paid_order.`,
      );
      return;
    }
  }

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      status: "disputed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .neq("status", "refunded");

  if (error) {
    throw new Error(`Dispute status update failed: ${error.message}`);
  }

  const emoji = dispute.status === "won" ? "✅" : "⚠️";
  await sendTelegramNotification(
    `${emoji} <b>DISPUTE STRIPE: ${escapeTelegramHtml(dispute.status.toUpperCase())}</b>\n` +
      `📦 Ordine: ${escapeTelegramHtml(order.order_number || String(order.id))}\n` +
      `💳 PaymentIntent: ${escapeTelegramHtml(paymentIntentId)}\n` +
      `Scadenza risposta: ${dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000).toISOString().slice(0, 10)
        : "N/D"}`,
  );
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = request.headers.get("stripe-signature");
  const endpointSecrets = [
    Deno.env.get("STRIPE_WEBHOOK_SECRET_LIVE"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET_TEST"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET"),
  ].filter((value, index, values): value is string =>
    Boolean(value) && values.indexOf(value) === index
  );
  if (!signature || endpointSecrets.length === 0) {
    return new Response("Invalid webhook configuration", { status: 400 });
  }

  let supabaseAdmin: any = null;
  let event: Stripe.Event | null = null;
  let claimed = false;

  try {
    const rawBody = await request.text();
    const cryptoProvider = Stripe.createSubtleCryptoProvider();

    for (const endpointSecret of endpointSecrets) {
      try {
        event = await getStripe().webhooks.constructEventAsync(
          rawBody,
          signature,
          endpointSecret,
          undefined,
          cryptoProvider,
        );
        break;
      } catch {
        // Test and live endpoints have different signing secrets even when
        // they share a URL. Try each explicitly configured secret.
      }
    }
    if (!event) throw new Error("Invalid webhook signature");

    // A production database must not be mutated by Stripe test-mode events.
    // Staging/dev environments can opt in explicitly after pointing the
    // endpoint at their isolated database.
    if (!isStripeEventModeAllowed(event.livemode)) {
      console.warn("Signed Stripe test-mode event ignored by environment policy");
      return new Response(
        JSON.stringify({ received: true, testModeIgnored: true }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const stripe = getStripe(event.livemode);

    supabaseAdmin = createAdminClient();
    claimed = await claimEvent(supabaseAdmin, event);
    if (!claimed) {
      return new Response(
        JSON.stringify({ received: true, duplicateOrLeased: true }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await fulfillCheckoutSession(
          supabaseAdmin,
          stripe,
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case "checkout.session.expired":
        await releaseCheckoutReservation(
          supabaseAdmin,
          (event.data.object as Stripe.Checkout.Session).id,
          "checkout_session_expired",
        );
        break;

      case "checkout.session.async_payment_failed":
        await releaseCheckoutReservation(
          supabaseAdmin,
          (event.data.object as Stripe.Checkout.Session).id,
          "async_payment_failed",
        );
        break;

      case "charge.refunded":
        await processFullRefund(
          supabaseAdmin,
          event.data.object as Stripe.Charge,
        );
        break;

      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
        await processDispute(supabaseAdmin, event.data.object as Stripe.Dispute);
        break;

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await sendTelegramNotification(
          `⚠️ <b>PAGAMENTO FALLITO</b>\n\n` +
            `Importo: €${(Number(paymentIntent.amount || 0) / 100).toFixed(2)}`,
        );
        break;
      }

      default:
        // Endpoint subscriptions are intentionally narrow. Unknown signed
        // events are safely acknowledged and retained in the event ledger.
        break;
    }

    await completeEvent(supabaseAdmin, event.id, true);
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown webhook error";
    console.error("Stripe webhook processing failed:", errorMessage);

    if (supabaseAdmin && event && claimed) {
      try {
        await completeEvent(supabaseAdmin, event.id, false, errorMessage);
      } catch (statusError) {
        console.error(
          "Stripe webhook failure status could not be recorded:",
          statusError instanceof Error ? statusError.message : "unknown error",
        );
      }
    }

    return new Response(
      event ? "Webhook processing failed" : "Invalid webhook signature",
      { status: event ? 500 : 400 },
    );
  }
});
