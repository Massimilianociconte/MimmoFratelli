/**
 * Complete Order Purchase Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Fallback function to create orders when webhook fails
 * Called from checkout-success page to ensure order is created
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
});

const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    }
  } catch (error) {
    console.error("Telegram notification error:", error);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { sessionId } = await req.json();

    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Missing sessionId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retrieve the Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });

    // Verify payment was successful
    if (session.payment_status !== "paid") {
      return new Response(JSON.stringify({ error: "Payment not completed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = session.metadata?.userId;
    if (!userId) {
      return new Response(JSON.stringify({ error: "No userId in session" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if this is a gift card purchase (handled by complete-giftcard-purchase)
    if (session.metadata?.type === "gift_card") {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Gift card purchase - use complete-giftcard-purchase instead" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check if order already exists for this payment
    const paymentId = typeof session.payment_intent === 'string' 
      ? session.payment_intent 
      : session.payment_intent?.id;

    const { data: existingOrder } = await supabaseAdmin
      .from("orders")
      .select("id, order_number")
      .eq("payment_id", paymentId)
      .maybeSingle();

    if (existingOrder) {
      console.log(`Order ${existingOrder.order_number} already exists for payment ${paymentId}`);
      
      // Fetch full order with items
      const { data: fullOrder } = await supabaseAdmin
        .from("orders")
        .select("*, order_items(*)")
        .eq("id", existingOrder.id)
        .single();

      return new Response(JSON.stringify({ 
        success: true, 
        order: fullOrder,
        alreadyExists: true 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse items from metadata (compressed format or legacy full format)
    let orderItems: OrderItem[] = [];
    try {
      if (session.metadata?.itemsCompact) {
        // New compressed format: {p: productId(8chars), q: quantity, pr: price, w: weight}
        const compactItems = JSON.parse(session.metadata.itemsCompact);
        // Get full product details from line_items
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
      if (session.metadata?.shipTo) {
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
        payment_id: paymentId,
        payment_status: "completed",
        gift_card_code: session.metadata?.giftCardCode || null,
        gift_card_amount: giftCardAmount,
        user_credit_amount: userCreditAmount,
      })
      .select()
      .single();

    if (orderError) {
      console.error("Order creation error:", orderError);
      return new Response(JSON.stringify({ error: "Order creation failed: " + orderError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      supabaseAdmin.from("cart_items").delete().eq("user_id", userId),
      // Fetch full order with items
      supabaseAdmin.from("orders").select("*, order_items(*)").eq("id", order.id).single()
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

    const [, fullOrderResult] = await Promise.all(postOrderOps);
    const fullOrder = fullOrderResult?.data;

    // Send Telegram notification asynchronously (don't wait for it)
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

✅ Pagamento completato via Stripe
⚠️ <i>(Creato via fallback)</i>`;

    // Fire and forget - don't block response
    sendTelegramNotification(telegramMessage).catch(err => console.error("Telegram error:", err));

    console.log(`Order ${orderNumber} created successfully via fallback for user ${userId}`);

    return new Response(JSON.stringify({ 
      success: true, 
      order: fullOrder 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Complete order error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
