/**
 * Stripe Webhook Handler Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Handles checkout.session.completed events to create orders
 * and send push notifications
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
});

const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID") || "";

interface OrderItem {
  productId: string;
  name: string;
  price: number;
  unitPrice?: number;
  quantity: number;
  size?: string;
  color?: string;
  weight_grams?: number | null;
}

interface PendingCheckoutSession {
  stripe_session_id: string;
  user_id: string;
  checkout_type: "order" | "gift_card";
  items: PendingCheckoutItem[];
  shipping_address: Record<string, string> | null;
  subtotal: number | string;
  discount_amount: number | string;
  gift_card_amount: number | string;
  user_credit_amount: number | string;
  shipping_cost: number | string;
  total: number | string;
  promotion_code: string | null;
  gift_card_code: string | null;
}

interface PendingCheckoutItem {
  product_id?: string;
  product_name?: string;
  product_price?: number | string;
  quantity?: number;
  size?: string;
  color?: string;
  weight_grams?: number | null;
}

function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MF-${timestamp}-${random}`;
}

function generateGiftCardCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 14; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateQRToken(): string {
  // Generate a UUID v4
  return crypto.randomUUID();
}

function getPaymentId(session: Stripe.Checkout.Session): string | null {
  if (!session.payment_intent) return null;
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
}

async function getExpandedSession(sessionId: string): Promise<Stripe.Checkout.Session> {
  return await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent", "line_items", "line_items.data.price.product"]
  });
}

function orderItemsFromLineItems(session: Stripe.Checkout.Session): OrderItem[] {
  const lineItems = session.line_items?.data || [];

  return lineItems.map((lineItem) => {
    const stripeProduct = lineItem.price?.product;
    const productData = typeof stripeProduct === "object" && stripeProduct !== null
      ? stripeProduct as { name?: string; metadata?: Record<string, string> }
      : null;
    const metadata = productData?.metadata || {};
    const quantity = lineItem.quantity || 1;
    const unitAmount = lineItem.price?.unit_amount ?? Math.round((lineItem.amount_subtotal || 0) / quantity);

    return {
      productId: metadata.productId || "",
      name: lineItem.description || productData?.name || "Prodotto",
      price: unitAmount / 100,
      quantity,
      size: metadata.size || "Standard",
      color: metadata.color || "Standard",
      weight_grams: metadata.weight_grams ? Number(metadata.weight_grams) : null
    };
  }).filter((item) => item.productId);
}

function orderItemsFromPendingCheckout(pendingCheckout: PendingCheckoutSession | null): OrderItem[] {
  if (!pendingCheckout?.items || !Array.isArray(pendingCheckout.items)) return [];

  return pendingCheckout.items
    .map((item) => ({
      productId: item.product_id || "",
      name: item.product_name || "Prodotto",
      price: Number(item.product_price || 0),
      quantity: Number(item.quantity || 1),
      size: item.size || "Standard",
      color: item.color || "Standard",
      weight_grams: item.weight_grams ? Number(item.weight_grams) : null
    }))
    .filter((item) => item.productId && item.price > 0);
}

async function loadPendingCheckout(
  supabaseAdmin: any,
  sessionId: string
): Promise<PendingCheckoutSession | null> {
  const { data, error } = await supabaseAdmin
    .from("pending_checkout_sessions")
    .select("*")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();

  if (error) {
    console.warn("Pending checkout lookup unavailable; falling back to Stripe data:", error);
    return null;
  }

  return data as PendingCheckoutSession | null;
}

async function markPendingCheckout(
  supabaseAdmin: any,
  sessionId: string,
  paymentId: string | null,
  status: "paid" | "completed" | "expired" | "cancelled"
): Promise<void> {
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (paymentId) patch.stripe_payment_id = paymentId;
  if (status === "completed") patch.completed_at = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("pending_checkout_sessions")
    .update(patch)
    .eq("stripe_session_id", sessionId);

  if (error) {
    console.warn("Pending checkout status update failed:", error);
  }
}

async function shouldProcessStripeEvent(supabaseAdmin: any, event: Stripe.Event): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("stripe_webhook_events")
    .insert({
      event_id: event.id,
      event_type: event.type,
      stripe_created: event.created ? new Date(event.created * 1000).toISOString() : null,
      status: "processing",
    });

  if (!error) return true;

  if (error.code !== "23505") {
    console.warn("Stripe event idempotency insert failed; continuing with payment_id guard:", error);
    return true;
  }

  const { data: existingEvent } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("status, attempts")
    .eq("event_id", event.id)
    .maybeSingle();

  if (existingEvent?.status === "processed") {
    console.log(`Stripe event ${event.id} already processed`);
    return false;
  }

  await supabaseAdmin
    .from("stripe_webhook_events")
    .update({
      attempts: Number(existingEvent?.attempts || 1) + 1,
      status: "processing",
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", event.id);

  return true;
}

async function markStripeEvent(
  supabaseAdmin: any,
  eventId: string,
  status: "processed" | "failed",
  errorMessage?: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("stripe_webhook_events")
    .update({
      status,
      error: errorMessage || null,
      updated_at: new Date().toISOString(),
      processed_at: status === "processed" ? new Date().toISOString() : null,
    })
    .eq("event_id", eventId);

  if (error) {
    console.warn("Stripe event status update failed:", error);
  }
}

async function sendTelegramNotification(message: string): Promise<void> {
  if (!telegramBotToken || !telegramChatId) {
    console.log("Telegram not configured, skipping notification");
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: "HTML",
      }),
    });

    if (!response.ok) {
      console.error("Telegram notification failed:", await response.text());
    } else {
      console.log("Telegram notification sent successfully");
    }
  } catch (error) {
    console.error("Telegram notification error:", error);
  }
}

async function handleGiftCardPurchase(
  supabaseAdmin: any, 
  session: Stripe.Checkout.Session, 
  userId: string
) {
  const metadata = session.metadata!;
  const amount = parseFloat(metadata.amount);
  const paymentId = getPaymentId(session);

  const { data: existingGiftCard } = await supabaseAdmin
    .from('gift_cards')
    .select('id, code')
    .or(`stripe_session_id.eq.${session.id},stripe_payment_id.eq.${paymentId}`)
    .maybeSingle();

  if (existingGiftCard) {
    console.log(`Gift card ${existingGiftCard.code} already exists for Stripe session ${session.id}`);
    return;
  }
  
  // Generate unique code
  let code = generateGiftCardCode();
  let attempts = 0;
  while (attempts < 10) {
    const { data: existing } = await supabaseAdmin
      .from('used_gift_card_codes')
      .select('code')
      .eq('code', code)
      .maybeSingle();
    
    if (!existing) break;
    code = generateGiftCardCode();
    attempts++;
  }

  // Generate QR token
  const qrToken = generateQRToken();

  // Get user profile for purchaser name
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', userId)
    .single();

  // Create the gift card
  const { data: giftCard, error: gcError } = await supabaseAdmin
    .from('gift_cards')
    .insert({
      code: code,
      qr_code_token: qrToken,
      amount: amount,
      balance: amount,
      remaining_balance: amount,
      recipient_name: metadata.recipientName,
      recipient_email: metadata.recipientEmail,
      sender_name: metadata.senderName,
      message: metadata.message || null,
      template: metadata.template || 'elegant',
      purchased_by: userId,
      stripe_session_id: session.id,
      stripe_payment_id: paymentId,
      purchaser_first_name: profile?.first_name || metadata.senderName.split(' ')[0],
      purchaser_last_name: profile?.last_name || metadata.senderName.split(' ').slice(1).join(' ') || '',
      is_active: true,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  if (gcError) {
    if (gcError.code === '23505') {
      console.log(`Gift card already inserted concurrently for Stripe session ${session.id}`);
      return;
    }

    console.error('Gift card creation error:', gcError);
    throw gcError;
  }

  // Add code to blacklist
  await supabaseAdmin
    .from('used_gift_card_codes')
    .insert({
      code: code,
      gift_card_id: giftCard.id,
      reason: 'generated'
    });

  // Create order record for the gift card purchase
  const orderNumber = generateOrderNumber();
  const { error: orderError } = await supabaseAdmin
    .from('orders')
    .insert({
      user_id: userId,
      order_number: orderNumber,
      status: 'confirmed',
      subtotal: amount,
      discount: 0,
      shipping_cost: 0,
      total: amount,
      shipping_address: { type: 'digital', note: 'Gift Card - Consegna digitale' },
      payment_provider: 'stripe',
      payment_id: getPaymentId(session),
      payment_status: 'completed',
      notes: `Gift Card per ${metadata.recipientName} (${metadata.recipientEmail})`,
    });

  if (orderError) {
    console.error('Order creation error for gift card:', orderError);
  }

  console.log(`Gift card ${code} created successfully for user ${userId}, amount: €${amount}`);

  // Send Telegram notification for gift card purchase
  const gcTelegramMessage = `🎁 <b>NUOVA GIFT CARD!</b>

💳 <b>Codice:</b> ${code}
💰 <b>Importo:</b> €${amount.toFixed(2)}

👤 <b>Da:</b> ${metadata.senderName}
🎯 <b>Per:</b> ${metadata.recipientName}
📧 <b>Email:</b> ${metadata.recipientEmail}

${metadata.message ? `💬 <i>"${metadata.message}"</i>` : ''}

✅ Pagamento completato via Stripe`;

  await sendTelegramNotification(gcTelegramMessage);
}

Deno.serve(async (req: Request) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("No signature", { status: 400 });
  }

  let supabaseAdmin: any = null;
  let eventId: string | null = null;

  try {
    const body = await req.text();
    const event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
    eventId = event.id;

    supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const shouldProcess = await shouldProcessStripeEvent(supabaseAdmin, event);
    if (!shouldProcess) {
      return new Response(JSON.stringify({ received: true, alreadyProcessed: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (event.type === "checkout.session.completed") {
      const eventSession = event.data.object as Stripe.Checkout.Session;
      const session = await getExpandedSession(eventSession.id);
      const pendingCheckout = await loadPendingCheckout(supabaseAdmin, session.id);
      
      const userId = session.metadata?.userId || pendingCheckout?.user_id;
      if (!userId) {
        console.error("No userId in session metadata");
        await markStripeEvent(supabaseAdmin, event.id, "failed", "No userId in session metadata");
        return new Response("No userId", { status: 400 });
      }

      const paymentId = getPaymentId(session);
      if (!paymentId) {
        console.error("No payment intent in session");
        await markStripeEvent(supabaseAdmin, event.id, "failed", "No payment intent in session");
        return new Response("No payment intent", { status: 400 });
      }

      await markPendingCheckout(supabaseAdmin, session.id, paymentId, "paid");

      // Gift cards are idempotent on stripe_session_id/stripe_payment_id; handle before
      // the generic order lookup so a pre-existing order cannot mask a missing gift card.
      if (session.metadata?.type === "gift_card" || pendingCheckout?.checkout_type === "gift_card") {
        await handleGiftCardPurchase(supabaseAdmin, session, userId);
        await markPendingCheckout(supabaseAdmin, session.id, paymentId, "completed");
        await markStripeEvent(supabaseAdmin, event.id, "processed");
        return new Response(JSON.stringify({ received: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data: existingOrder } = await supabaseAdmin
        .from("orders")
        .select("id, order_number")
        .eq("payment_id", paymentId)
        .maybeSingle();

      if (existingOrder) {
        console.log(`Order ${existingOrder.order_number} already exists for payment ${paymentId}, skipping webhook side effects`);
        await markPendingCheckout(supabaseAdmin, session.id, paymentId, "completed");
        await markStripeEvent(supabaseAdmin, event.id, "processed");
        return new Response(JSON.stringify({ received: true, alreadyExists: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Parse items from metadata (compressed format or legacy full format)
      let orderItems: OrderItem[] = [];
      try {
        const pendingItems = orderItemsFromPendingCheckout(pendingCheckout);
        const expandedItems = orderItemsFromLineItems(session);
        if (pendingItems.length > 0) {
          orderItems = pendingItems;
        } else if (expandedItems.length > 0) {
          orderItems = expandedItems;
        } else if (session.metadata?.itemsCompact) {
          // Legacy compressed format: {p: productId prefix, q: quantity, pr: price, w: weight}
          const compactItems = JSON.parse(session.metadata.itemsCompact);
          // Get full product IDs from line_items or expand from compact
          const lineItems = session.line_items?.data || [];
          orderItems = compactItems.map((item: {p: string, q: number, pr: number, w: number}, index: number) => {
            const lineItem = lineItems[index];
            const productData = lineItem?.price?.product as {name?: string, metadata?: {productId?: string, size?: string, color?: string}} | undefined;
            return {
              productId: productData?.metadata?.productId || item.p,
              name: lineItem?.description || productData?.name || "Prodotto",
              price: item.pr,
              quantity: item.q,
              size: productData?.metadata?.size || "Standard",
              color: productData?.metadata?.color || "Standard",
              weight_grams: item.w || null
            };
          });
        } else if (session.metadata?.itemsJson) {
          // Legacy full format (for backward compatibility)
          orderItems = JSON.parse(session.metadata.itemsJson);
        }
      } catch (e) {
        console.error("Failed to parse items from metadata:", e);
      }

      // Parse shipping address from metadata (new compressed or legacy format)
      let shippingAddress: Record<string, string> = {};
      try {
        if (pendingCheckout?.shipping_address) {
          shippingAddress = pendingCheckout.shipping_address;
        } else if (session.metadata?.shipTo) {
          // New compressed format: {n: name, a: address, c: city, p: postalCode, pr: province, ph: phone}
          const ship = JSON.parse(session.metadata.shipTo);
          const nameParts = (ship.n || "").split(" ");
          shippingAddress = {
            firstName: nameParts[0] || "",
            lastName: nameParts.slice(1).join(" ") || "",
            address: ship.a || "",
            city: ship.c || "",
            postalCode: ship.p || "",
            province: ship.pr || "",
            phone: ship.ph || "",
            country: "IT"
          };
        } else if (session.metadata?.shippingAddress) {
          // Legacy full format
          shippingAddress = JSON.parse(session.metadata.shippingAddress);
        } else if (session.shipping_details?.address) {
          shippingAddress = session.shipping_details.address as Record<string, string>;
        }
      } catch (e) {
        console.error("Failed to parse shipping address:", e);
      }

      // Calculate amounts
      const subtotal = Number(pendingCheckout?.subtotal ?? ((session.amount_subtotal || 0) / 100));
      const total = Number(pendingCheckout?.total ?? ((session.amount_total || 0) / 100));
      const shippingCost = Number(pendingCheckout?.shipping_cost ?? ((session.shipping_cost?.amount_total || 0) / 100));
      const discountAmount = Number(pendingCheckout?.discount_amount ?? (parseInt(session.metadata?.discountAmount || "0") / 100));
      const giftCardAmount = Number(pendingCheckout?.gift_card_amount ?? (parseInt(session.metadata?.giftCardAmount || "0") / 100));
      const userCreditAmount = Number(pendingCheckout?.user_credit_amount ?? (parseInt(session.metadata?.userCreditAmount || "0") / 100));
      const giftCardCode = pendingCheckout?.gift_card_code || session.metadata?.giftCardCode || null;
      const promotionCode = pendingCheckout?.promotion_code || session.metadata?.promotionCode || null;

      const orderNumber = generateOrderNumber();

      // Create order
      const { data: order, error: orderError } = await supabaseAdmin
        .from("orders")
        .insert({
          user_id: userId,
          order_number: orderNumber,
          status: "confirmed",
          subtotal: subtotal,
          discount: discountAmount + giftCardAmount + userCreditAmount,
          shipping_cost: shippingCost,
          total: total,
          shipping_address: shippingAddress,
          payment_provider: "stripe",
          payment_id: paymentId,
          payment_status: "completed",
          gift_card_code: giftCardCode,
          gift_card_amount: giftCardAmount,
          user_credit_amount: userCreditAmount,
        })
        .select()
        .single();

      if (orderError) {
        if (orderError.code === "23505") {
          console.log(`Order already inserted concurrently for payment ${paymentId}, skipping webhook side effects`);
          await markPendingCheckout(supabaseAdmin, session.id, paymentId, "completed");
          await markStripeEvent(supabaseAdmin, event.id, "processed");
          return new Response(JSON.stringify({ received: true, alreadyExists: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        console.error("Order creation error:", orderError);
        await markStripeEvent(supabaseAdmin, event.id, "failed", orderError.message);
        return new Response("Order creation failed: " + orderError.message, { status: 500 });
      }

      // Create order items
      if (orderItems.length > 0) {
        const itemsToInsert = orderItems.map(item => ({
          order_id: order.id,
          product_id: item.productId,
          product_name: item.name,
          product_price: item.price,
          quantity: item.quantity,
          size: item.size || "Standard",
          color: item.color || "Standard",
          weight_grams: item.weight_grams || null,
          unit_measure: item.weight_grams ? "kg" : "pz",
        }));

        const { error: itemsError } = await supabaseAdmin
          .from("order_items")
          .insert(itemsToInsert);

        if (itemsError) {
          console.error("Order items creation error:", itemsError);
        }
      }

      // Run post-order operations in parallel for better performance
      const postOrderOps: Promise<any>[] = [
        // Clear user's cart
        supabaseAdmin.from("cart_items").delete().eq("user_id", userId)
      ];

      // Add gift card update if needed
      if (giftCardCode && giftCardAmount > 0) {
        postOrderOps.push(
          supabaseAdmin
            .from("gift_cards")
            .select("id, balance, remaining_balance, amount")
            .eq("code", giftCardCode.toUpperCase().replace(/-/g, ""))
            .single()
            .then(({ data: gc }) => {
              if (gc) {
                const currentBalance = Math.min(
                  Number(gc.remaining_balance ?? gc.balance ?? gc.amount),
                  Number(gc.balance ?? gc.amount),
                  Number(gc.amount)
                );
                const newBalance = Math.max(0, currentBalance - giftCardAmount);
                return supabaseAdmin
                  .from("gift_cards")
                  .update({
                    balance: newBalance,
                    remaining_balance: newBalance,
                    is_active: newBalance > 0
                  })
                  .eq("id", gc.id);
              }
            })
        );
      }

      // Add promotion increment if needed
      if (promotionCode) {
        postOrderOps.push(
          supabaseAdmin.rpc('increment_promotion_usage', { p_code: promotionCode.toUpperCase() })
        );
      }

      // Deduct user credit if used
      if (userCreditAmount > 0) {
        postOrderOps.push(
          supabaseAdmin
            .from("user_credits")
            .select("id, balance")
            .eq("user_id", userId)
            .single()
            .then(({ data: credit }) => {
              if (credit) {
                const newBalance = Math.max(0, credit.balance - userCreditAmount);
                return supabaseAdmin
                  .from("user_credits")
                  .update({ balance: newBalance })
                  .eq("id", credit.id)
                  .then(() => {
                    // Record the transaction
                    return supabaseAdmin
                      .from("credit_transactions")
                      .insert({
                        user_id: userId,
                        amount: -userCreditAmount,
                        transaction_type: "purchase",
                        reference_id: order.id,
                        reference_type: "order",
                        balance_before: credit.balance,
                        balance_after: newBalance,
                        description: `Pagamento ordine #${orderNumber}`
                      });
                  });
              }
            })
        );
      }

      await Promise.all(postOrderOps);

      // Process referral conversion if this is user's first order
      // Requirements: 4.1, 4.2, 5.2
      try {
        const referralResult = await supabaseAdmin.rpc('process_referral_conversion', {
          p_referee_id: userId,
          p_order_id: order.id
        });
        
        if (referralResult.data?.success && referralResult.data?.reward_credited) {
          console.log(`Referral reward credited to ${referralResult.data.referrer_id}: €${referralResult.data.reward_amount}`);
          
          // Send notification to referrer about the reward
          const referrerNotification = `🎉 <b>REFERRAL CONVERTITO!</b>

💰 Hai ricevuto <b>€${referralResult.data.reward_amount.toFixed(2)}</b> di credito!

Un amico che hai invitato ha completato il suo primo ordine.
Il credito è stato aggiunto al tuo account.

Continua a invitare amici per guadagnare altri premi! 🎁`;
          
          sendTelegramNotification(referrerNotification).catch(err => console.error("Referral notification error:", err));
        }
      } catch (refErr) {
        console.log("Referral processing skipped or failed:", refErr);
        // Don't fail the webhook for referral errors
      }

      // Send Telegram notification asynchronously (don't block webhook response)
      const addr = shippingAddress as any;
      const itemsList = orderItems.map(item => {
        let itemDesc = item.name;
        if (item.weight_grams) {
          const weightDisplay = item.weight_grams >= 1000 
            ? `${(item.weight_grams / 1000).toFixed(item.weight_grams % 1000 === 0 ? 0 : 2)} Kg`
            : `${item.weight_grams} g`;
          itemDesc += ` (${weightDisplay})`;
        }
        return `• ${itemDesc} x${item.quantity} - €${(item.price * item.quantity).toFixed(2)}`;
      }).join('\n');
      const telegramMessage = `🛒 <b>NUOVO ORDINE!</b>

📦 <b>Ordine:</b> #${orderNumber}
💰 <b>Totale:</b> €${total.toFixed(2)}

📍 <b>Consegna:</b>
${addr?.firstName || ''} ${addr?.lastName || ''}
${addr?.address || ''}
${addr?.postalCode || ''} ${addr?.city || ''} (${addr?.province || ''})
📞 ${addr?.phone || 'N/D'}

🛍️ <b>Prodotti:</b>
${itemsList || 'Nessun dettaglio'}

✅ Pagamento completato via Stripe`;

      // Fire and forget - don't block webhook response
      sendTelegramNotification(telegramMessage).catch(err => console.error("Telegram error:", err));

      console.log(`Order ${orderNumber} created successfully for user ${userId}`);
      await markPendingCheckout(supabaseAdmin, session.id, paymentId, "completed");
    }

    await markStripeEvent(supabaseAdmin, event.id, "processed");
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    if (supabaseAdmin && eventId) {
      await markStripeEvent(
        supabaseAdmin,
        eventId,
        "failed",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
    return new Response(`Webhook Error: ${error instanceof Error ? error.message : "Unknown error"}`, { status: 400 });
  }
});
