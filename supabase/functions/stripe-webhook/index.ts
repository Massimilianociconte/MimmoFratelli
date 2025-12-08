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
      purchaser_first_name: profile?.first_name || metadata.senderName.split(' ')[0],
      purchaser_last_name: profile?.last_name || metadata.senderName.split(' ').slice(1).join(' ') || '',
      is_active: true,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();

  if (gcError) {
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
      payment_id: session.payment_intent as string,
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

  try {
    const body = await req.text();
    const event = stripe.webhooks.constructEvent(body, signature, endpointSecret);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      const userId = session.metadata?.userId;
      if (!userId) {
        console.error("No userId in session metadata");
        return new Response("No userId", { status: 400 });
      }

      // Check if this is a gift card purchase
      if (session.metadata?.type === "gift_card") {
        await handleGiftCardPurchase(supabaseAdmin, session, userId);
        return new Response(JSON.stringify({ received: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Parse items from metadata
      let orderItems: OrderItem[] = [];
      try {
        if (session.metadata?.itemsJson) {
          orderItems = JSON.parse(session.metadata.itemsJson);
        }
      } catch (e) {
        console.error("Failed to parse items from metadata:", e);
      }

      // Parse shipping address from metadata
      let shippingAddress = {};
      try {
        if (session.metadata?.shippingAddress) {
          shippingAddress = JSON.parse(session.metadata.shippingAddress);
        } else if (session.shipping_details?.address) {
          shippingAddress = session.shipping_details.address;
        }
      } catch (e) {
        console.error("Failed to parse shipping address:", e);
      }

      // Calculate amounts
      const subtotal = (session.amount_subtotal || 0) / 100;
      const total = (session.amount_total || 0) / 100;
      const shippingCost = (session.shipping_cost?.amount_total || 0) / 100;
      const discountAmount = parseInt(session.metadata?.discountAmount || "0") / 100;
      const giftCardAmount = parseInt(session.metadata?.giftCardAmount || "0") / 100;
      const userCreditAmount = parseInt(session.metadata?.userCreditAmount || "0") / 100;

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
          payment_id: session.payment_intent as string,
          payment_status: "completed",
          gift_card_code: session.metadata?.giftCardCode || null,
          gift_card_amount: giftCardAmount,
          user_credit_amount: userCreditAmount,
        })
        .select()
        .single();

      if (orderError) {
        console.error("Order creation error:", orderError);
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
      const giftCardCode = session.metadata?.giftCardCode;
      const promotionCode = session.metadata?.promotionCode;

      const postOrderOps: Promise<any>[] = [
        // Clear user's cart
        supabaseAdmin.from("cart_items").delete().eq("user_id", userId)
      ];

      // Add gift card update if needed
      if (giftCardCode && giftCardAmount > 0) {
        postOrderOps.push(
          supabaseAdmin
            .from("gift_cards")
            .select("id, balance")
            .eq("code", giftCardCode.toUpperCase())
            .single()
            .then(({ data: gc }) => {
              if (gc) {
                const newBalance = Math.max(0, gc.balance - giftCardAmount);
                return supabaseAdmin
                  .from("gift_cards")
                  .update({ balance: newBalance, is_active: newBalance > 0 })
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
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(`Webhook Error: ${error instanceof Error ? error.message : "Unknown error"}`, { status: 400 });
  }
});
