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

const ALLOWED_ORIGINS = [
  "https://www.mimmofratelli.com",
  "https://mimmofratelli.com",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5500",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : "https://www.mimmofratelli.com";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

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

function getPaymentId(session: Stripe.Checkout.Session): string | null {
  if (!session.payment_intent) return null;
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
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
  status: "paid" | "completed"
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  try {
    const { sessionId } = await req.json();

    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Missing sessionId" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Retrieve the Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent', 'line_items', 'line_items.data.price.product']
    });

    // Verify payment was successful
    if (session.payment_status !== "paid") {
      return new Response(JSON.stringify({ error: "Payment not completed" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const pendingCheckout = await loadPendingCheckout(supabaseAdmin, session.id);

    const userId = session.metadata?.userId || pendingCheckout?.user_id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "No userId in session" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Devi effettuare il login" }), {
        status: 401,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    if (user.id !== userId) {
      return new Response(JSON.stringify({ error: "Utente non autorizzato per questa sessione" }), {
        status: 403,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Skip if this is a gift card purchase (handled by complete-giftcard-purchase)
    if (session.metadata?.type === "gift_card" || pendingCheckout?.checkout_type === "gift_card") {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Gift card purchase - use complete-giftcard-purchase instead" 
      }), {
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Check if order already exists for this payment
    const paymentId = getPaymentId(session);

    if (!paymentId) {
      return new Response(JSON.stringify({ error: "No payment intent in session" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    await markPendingCheckout(supabaseAdmin, session.id, paymentId, "paid");

    const { data: existingOrder } = await supabaseAdmin
      .from("orders")
      .select("id, order_number")
      .eq("payment_id", paymentId)
      .maybeSingle();

    if (existingOrder) {
      console.log(`Order ${existingOrder.order_number} already exists for payment ${paymentId}`);
      await markPendingCheckout(supabaseAdmin, session.id, paymentId, "completed");
      
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
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
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
        await markPendingCheckout(supabaseAdmin, session.id, paymentId, "completed");
        const { data: fullOrder } = await supabaseAdmin
          .from("orders")
          .select("*, order_items(*)")
          .eq("payment_id", paymentId)
          .single();

        return new Response(JSON.stringify({
          success: true,
          order: fullOrder,
          alreadyExists: true
        }), {
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }

      console.error("Order creation error:", orderError);
      return new Response(JSON.stringify({ error: "Order creation failed: " + orderError.message }), {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
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
    await markPendingCheckout(supabaseAdmin, session.id, paymentId, "completed");

    return new Response(JSON.stringify({ 
      success: true, 
      order: fullOrder 
    }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Complete order error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
