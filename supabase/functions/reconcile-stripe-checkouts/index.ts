/**
 * Reconciliation sweep for paid-but-unfulfilled Checkout Sessions.
 *
 * Closes the last money-loss window of the checkout pipeline: if
 * `checkout.session.completed` cannot be fulfilled after every Stripe retry and
 * the customer never reopens the success page, the payment would otherwise stay
 * orphaned forever. This function:
 *   1. lists stale trusted snapshots (pending_checkout_sessions);
 *   2. asks Stripe for the authoritative session state;
 *   3. fulfills paid sessions through the SAME atomic path used by the webhook;
 *   4. releases reservations for dead sessions.
 *
 * Trigger: pg_cron + pg_net (see migration 029) or any external scheduler.
 * Auth: shared-secret header, because the gateway JWT is not available to cron.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  finalizeGiftCardFromStripe,
  finalizeOrderFromStripe,
  getUserEmail,
  loadPendingCheckout,
  releaseCheckoutReservation,
} from "../_shared/fulfillment.ts";
import {
  escapeTelegramHtml,
  getAsyncReservationMinutes,
  getStripe,
} from "../_shared/payment.ts";
import {
  sendGiftCardEmailTo,
  sendOrderConfirmationEmail,
} from "../_shared/email.ts";

const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID") || "";

// Sessions younger than the TTL + grace are still owned by the normal flow
// (webhook retries + success-page fallback). Only older snapshots are swept.
const MIN_AGE_MINUTES = 45;
const BATCH_LIMIT = 25;

function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("Supabase service configuration is missing");
  }
  return createClient(url, serviceKey);
}

async function sendTelegramNotification(message: string): Promise<void> {
  if (!telegramBotToken || !telegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: "HTML",
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.error(
      "Telegram notification failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

/** Derives the Stripe mode from the canonical session id prefix. */
function livemodeFromSessionId(sessionId: string): boolean | undefined {
  if (sessionId.startsWith("cs_live_")) return true;
  if (sessionId.startsWith("cs_test_")) return false;
  return undefined;
}

interface StalePendingRow {
  stripe_session_id: string;
  checkout_type: "order" | "gift_card";
  created_at: string;
}

async function listStalePendings(
  supabaseAdmin: any,
): Promise<StalePendingRow[]> {
  const cutoff = new Date(
    Date.now() - MIN_AGE_MINUTES * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabaseAdmin
    .from("pending_checkout_sessions")
    .select("stripe_session_id, checkout_type, created_at")
    .in("status", ["created", "paid"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    throw new Error(`Stale pending lookup failed: ${error.message}`);
  }
  return (data || []) as StalePendingRow[];
}

async function extendReservationQuietly(
  supabaseAdmin: any,
  sessionId: string,
): Promise<void> {
  const minutes = getAsyncReservationMinutes();
  await supabaseAdmin.rpc("extend_checkout_reservation_for_async_payment", {
    p_stripe_session_id: sessionId,
    p_hold_minutes: minutes,
  }).catch(() => null);
}

async function recordLegalAcceptance(
  supabaseAdmin: any,
  session: any,
): Promise<void> {
  const termsVersion = session.metadata?.termsVersion;
  const privacyVersion = session.metadata?.privacyVersion;
  if (!termsVersion || !privacyVersion) return;

  const checkoutType = session.metadata?.type === "gift_card"
    ? "gift_card"
    : "order";
  const { error } = await supabaseAdmin
    .from("checkout_legal_acceptances")
    .upsert({
      stripe_session_id: session.id,
      user_id: session.metadata?.userId || null,
      checkout_type: checkoutType,
      terms_version: termsVersion,
      privacy_version: privacyVersion,
      stripe_terms_status: "accepted",
      checkout_session_created_at: new Date(session.created * 1000)
        .toISOString(),
      recorded_at: new Date().toISOString(),
      livemode: session.livemode,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stripe_session_id" });

  if (error) {
    // Non-fatal: fulfillment must not depend on the compliance ledger when the
    // webhook already had a chance to record it.
    console.error(
      "Reconciler legal acceptance persistence failed:",
      error.message,
    );
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST" && request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedSecret = Deno.env.get("RECONCILE_SECRET_KEY") || "";
  const providedSecret = request.headers.get("x-reconcile-key") || "";
  if (!expectedSecret || providedSecret.length !== expectedSecret.length ||
    !timingSafeEqual(providedSecret, expectedSecret)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  let supabaseAdmin: any;
  try {
    supabaseAdmin = createAdminClient();
  } catch (error) {
    console.error(
      "Reconciler bootstrap failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return new Response("Service unavailable", { status: 503 });
  }

  const summary = {
    inspected: 0,
    ordersRecovered: 0,
    giftCardsRecovered: 0,
    released: 0,
    extended: 0,
    errors: [] as string[],
  };

  try {
    const staleRows = await listStalePendings(supabaseAdmin);

    for (const row of staleRows) {
      summary.inspected += 1;
      const sessionId = row.stripe_session_id;

      try {
        const stripe = getStripe(livemodeFromSessionId(sessionId));
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
          expand: ["payment_intent"],
        });

        if (
          session.payment_status === "paid" ||
          session.payment_status === "no_payment_required"
        ) {
          const pending = await loadPendingCheckout(supabaseAdmin, sessionId);
          await recordLegalAcceptance(supabaseAdmin, session);

          if (pending.checkout_type === "gift_card") {
            const result = await finalizeGiftCardFromStripe(
              supabaseAdmin,
              session,
            );
            summary.giftCardsRecovered += 1;
            if (result.created) {
              await sendGiftCardEmailTo(result.giftCard as any).catch(() =>
                false
              );
              await sendTelegramNotification(
                `🧹 <b>RECUPERATO (reconciler)</b>\n` +
                  `🎁 Gift card adempita dopo fallimento webhook`,
              );
            }
          } else {
            const result = await finalizeOrderFromStripe(supabaseAdmin, session);
            summary.ordersRecovered += 1;
            if (result.created) {
              try {
                const email = await getUserEmail(
                  supabaseAdmin,
                  (result.order as any).user_id,
                );
                if (email) {
                  await sendOrderConfirmationEmail(email, result.order);
                }
              } catch (emailError) {
                console.error(
                  "Reconciler order email failed:",
                  emailError instanceof Error
                    ? emailError.message
                    : "unknown error",
                );
              }
              await sendTelegramNotification(
                `🧹 <b>RECUPERATO (reconciler)</b>\n` +
                  `📦 Ordine #${escapeTelegramHtml((result.order as any).order_number)}\n` +
                  `💰 €${Number((result.order as any).total || 0).toFixed(2)}\n` +
                  `⚠️ Webhook non pervenuto entro ${MIN_AGE_MINUTES} minuti`,
              );
            }
          }
          continue;
        }

        if (
          session.status === "expired" ||
          session.status === "complete"
        ) {
          await releaseCheckoutReservation(
            supabaseAdmin,
            sessionId,
            session.status === "expired"
              ? "checkout_session_expired"
              : "reconciler_released_dead_session",
          );
          summary.released += 1;
          continue;
        }

        // Still open beyond its TTL: force expiry so that Stripe emits the
        // authoritative expired event, then release defensively.
        if (session.status === "open") {
          try {
            await stripe.checkout.sessions.expire(sessionId);
          } catch (expireError) {
            console.error(
              "Reconciler expire failed:",
              expireError instanceof Error ? expireError.message : "unknown",
            );
          }
          await releaseCheckoutReservation(
            supabaseAdmin,
            sessionId,
            "reconciler_expired_stale_open_session",
          );
          summary.released += 1;
          continue;
        }

        // Delayed payment still processing: keep the reservation alive.
        if (row.checkout_type === "order") {
          await extendReservationQuietly(supabaseAdmin, sessionId);
          summary.extended += 1;
        }
      } catch (rowError) {
        const message = rowError instanceof Error
          ? rowError.message
          : "unknown error";
        console.error(`Reconcile failed for ${sessionId}:`, message);
        summary.errors.push(`${sessionId}: ${message}`);
      }
    }

    if (summary.ordersRecovered > 0 || summary.errors.length > 0) {
      await sendTelegramNotification(
        `🧹 <b>RICONCILIAZIONE</b>\n` +
          `Ispezionati: ${summary.inspected}\n` +
          `Ordini recuperati: ${summary.ordersRecovered}\n` +
          `Gift card recuperate: ${summary.giftCardsRecovered}\n` +
          `Rilasci: ${summary.released}` +
          (summary.errors.length > 0
            ? `\n❌ Errori: ${summary.errors.length}`
            : ""),
      );
    }

    return new Response(JSON.stringify({ success: true, ...summary }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      "Reconciler run failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return new Response(
      JSON.stringify({ success: false, ...summary }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

/**
 * Constant-time-ish comparison without depending on platform-specific timing
 * APIs available in the Edge runtime.
 */
function timingSafeEqual(a: string, b: string): boolean {
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}
