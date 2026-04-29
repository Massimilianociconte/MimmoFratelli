/**
 * Stripe Checkout Session Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Creates dynamic checkout sessions without pre-created Stripe products
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
});

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

interface CartItem {
  productId: string;
  name: string;
  price: number;
  unitPrice?: number; // Price per unit (kg/pz)
  quantity: number;
  size?: string;
  color?: string;
  image?: string;
  weight_grams?: number | null;
}

interface ShippingAddress {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  postalCode: string;
  province: string;
  phone: string;
  country?: string;
}

interface CheckoutRequest {
  items: CartItem[];
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  giftCardCode?: string;
  promotionCode?: string;
  shippingAddress?: ShippingAddress;
  userCredit?: number; // Credito utente da utilizzare (in euro)
}

interface ProductRecord {
  id: string;
  name: string;
  price: number | string;
  sale_price: number | string | null;
  images: string[] | null;
  is_active: boolean;
  category_id: string | null;
}

function jsonResponse(req: Request, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function toCents(amount: number): number {
  return Math.round(Number(amount || 0) * 100);
}

function normalizeCode(code?: string): string {
  return (code || "").trim().toUpperCase();
}

async function buildServerPricedItems(
  supabaseAdmin: any,
  rawItems: CartItem[]
): Promise<{ items?: CartItem[]; error?: string }> {
  const productIds = [...new Set(rawItems.map((item) => item.productId).filter(Boolean))];

  if (productIds.length !== rawItems.length && productIds.length === 0) {
    return { error: "Prodotti non validi" };
  }

  const { data: products, error } = await supabaseAdmin
    .from("products")
    .select("id, name, price, sale_price, images, is_active, category_id")
    .in("id", productIds);

  if (error) {
    console.error("Product repricing error:", error);
    return { error: "Errore nella verifica dei prodotti" };
  }

  const productMap = new Map<string, ProductRecord>(
    (products || []).map((product: ProductRecord) => [product.id, product])
  );

  const serverItems: CartItem[] = [];

  for (const item of rawItems) {
    const product = productMap.get(item.productId);
    const quantity = Number(item.quantity);
    const weightGrams = item.weight_grams ? Number(item.weight_grams) : null;

    if (!product || !product.is_active) {
      return { error: "Uno o più prodotti non sono più disponibili" };
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return { error: "Quantità prodotto non valida" };
    }

    if (weightGrams !== null && (!Number.isInteger(weightGrams) || weightGrams <= 0)) {
      return { error: "Formato peso prodotto non valido" };
    }

    const basePrice = Number(product.sale_price ?? product.price ?? 0);
    const unitAmount = weightGrams ? (basePrice * weightGrams) / 1000 : basePrice;
    const unitAmountCents = toCents(unitAmount);

    if (unitAmountCents <= 0) {
      return { error: "Prezzo prodotto non valido" };
    }

    serverItems.push({
      productId: product.id,
      name: product.name,
      price: unitAmountCents / 100,
      unitPrice: basePrice,
      quantity,
      size: item.size || "Standard",
      color: item.color || "Fresco",
      image: Array.isArray(product.images) ? product.images[0] || "" : "",
      weight_grams: weightGrams,
    });
  }

  return { items: serverItems };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  try {
    console.log("Starting checkout session creation...");
    
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      console.log("User not authenticated");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }
    console.log("User authenticated:", user.id);

    const body = await req.json();
    console.log("Request body received, items count:", body.items?.length);
    
    const { 
      items, 
      successUrl, 
      cancelUrl, 
      customerEmail, 
      giftCardCode, 
      promotionCode,
      shippingAddress,
      userCredit 
    }: CheckoutRequest = body;

    if (!items || items.length === 0) {
      return jsonResponse(req, 400, { error: "Carrello vuoto" });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const pricedItemsResult = await buildServerPricedItems(supabaseAdmin, items);
    if (pricedItemsResult.error || !pricedItemsResult.items) {
      return jsonResponse(req, 400, { error: pricedItemsResult.error || "Carrello non valido" });
    }

    const checkoutItems = pricedItemsResult.items;

    // Calculate subtotal in cents
    const subtotal = checkoutItems.reduce((sum, item) => sum + toCents(item.price) * item.quantity, 0);
    
    // Fetch promotion and gift card in parallel for better performance
    const [promoResult, giftCardResult] = await Promise.all([
      promotionCode 
        ? supabaseAdmin
            .from("promotions")
            .select("code, discount_type, discount_value, min_purchase, max_discount, usage_limit, usage_count, applies_to, applies_to_ids, starts_at, ends_at, is_active, user_id, is_first_order_code")
            .eq("code", normalizeCode(promotionCode))
            .maybeSingle()
        : Promise.resolve({ data: null }),
      giftCardCode
        ? supabaseAdmin
            .from("gift_cards")
            .select("amount, balance, remaining_balance, is_active, is_redeemed, expires_at")
            .eq("code", normalizeCode(giftCardCode).replace(/-/g, ""))
            .maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    // Calculate discount from promotion
    let discountAmount = 0;
    const promo = promoResult.data;
    if (promotionCode && !promo) {
      return jsonResponse(req, 400, { error: "Codice promozionale non valido" });
    }

    if (promo) {
      const now = Date.now();
      const promoStarts = promo.starts_at ? new Date(promo.starts_at).getTime() : 0;
      const promoEnds = promo.ends_at ? new Date(promo.ends_at).getTime() : 0;

      if (!promo.is_active || now < promoStarts || now > promoEnds) {
        return jsonResponse(req, 400, { error: "Codice promozionale scaduto o non attivo" });
      }

      if (promo.usage_limit && Number(promo.usage_count || 0) >= Number(promo.usage_limit)) {
        return jsonResponse(req, 400, { error: "Codice promozionale esaurito" });
      }

      if (promo.min_purchase && subtotal < toCents(Number(promo.min_purchase))) {
        return jsonResponse(req, 400, { error: `Importo minimo €${Number(promo.min_purchase).toFixed(2)}` });
      }

      if (promo.is_first_order_code) {
        if (promo.user_id && promo.user_id !== user.id) {
          return jsonResponse(req, 400, { error: "Codice promozionale non associato a questo account" });
        }

        const { count: completedOrders } = await supabaseAdmin
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("payment_status", "completed");

        if ((completedOrders || 0) > 0) {
          return jsonResponse(req, 400, { error: "Codice valido solo per il primo ordine" });
        }
      }

      let eligibleSubtotal = subtotal;
      const appliesToIds = Array.isArray(promo.applies_to_ids) ? promo.applies_to_ids : [];
      if (promo.applies_to === "product" && appliesToIds.length > 0) {
        eligibleSubtotal = checkoutItems
          .filter((item) => appliesToIds.includes(item.productId))
          .reduce((sum, item) => sum + toCents(item.price) * item.quantity, 0);
      } else if (promo.applies_to === "category" && appliesToIds.length > 0) {
        const { data: eligibleProducts } = await supabaseAdmin
          .from("products")
          .select("id")
          .in("id", checkoutItems.map((item) => item.productId))
          .in("category_id", appliesToIds);
        const eligibleProductIds = new Set((eligibleProducts || []).map((product: { id: string }) => product.id));
        eligibleSubtotal = checkoutItems
          .filter((item) => eligibleProductIds.has(item.productId))
          .reduce((sum, item) => sum + toCents(item.price) * item.quantity, 0);
      }

      if (eligibleSubtotal <= 0) {
        return jsonResponse(req, 400, { error: "Codice promozionale non applicabile a questi prodotti" });
      }

      if (promo.discount_type === "percentage") {
        discountAmount = Math.round((eligibleSubtotal * Number(promo.discount_value)) / 100);
        if (promo.max_discount) {
          discountAmount = Math.min(discountAmount, toCents(Number(promo.max_discount)));
        }
      } else {
        discountAmount = toCents(Number(promo.discount_value));
      }
      discountAmount = Math.min(discountAmount, eligibleSubtotal);
    }

    // Calculate gift card discount
    let giftCardAmount = 0;
    const giftCard = giftCardResult.data;
    if (giftCardCode && !giftCard) {
      return jsonResponse(req, 400, { error: "Gift card non valida" });
    }

    if (giftCard) {
      const giftCardBalance = Math.max(
        0,
        Math.min(
          Number(giftCard.remaining_balance ?? giftCard.balance ?? giftCard.amount),
          Number(giftCard.balance ?? giftCard.amount),
          Number(giftCard.amount)
        )
      );
      const isExpired = giftCard.expires_at && new Date(giftCard.expires_at).getTime() < Date.now();
      if (!giftCard.is_active || giftCard.is_redeemed || isExpired || giftCardBalance <= 0) {
        return jsonResponse(req, 400, { error: "Gift card non valida o esaurita" });
      }
      giftCardAmount = Math.min(toCents(giftCardBalance), subtotal - discountAmount);
    }

    // Calculate base shipping (free over €50)
    const FREE_SHIPPING_THRESHOLD = 5000; // €50 in cents
    const SHIPPING_COST = 290; // €2.90 in cents (same as frontend config)
    let shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_COST;

    // Verify and calculate user credit (after shipping is calculated)
    let userCreditAmount = 0;
    let creditForProducts = 0; // Amount to apply via coupon (max = subtotal)
    let creditForShipping = 0; // Amount to reduce from shipping cost
    
    if (userCredit && userCredit > 0) {
      // Verify user has enough credit in database
      const { data: creditData } = await supabaseClient
        .from("user_credits")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle();
      
      const availableCredit = creditData?.balance || 0;
      const requestedCreditCents = Math.round(userCredit * 100);
      const availableCreditCents = Math.round(availableCredit * 100);
      
      // Total order amount (subtotal + shipping - other discounts)
      const totalOrderAmount = subtotal + shipping - discountAmount - giftCardAmount;
      
      // Total credit to use (min of requested, available, and order total)
      userCreditAmount = Math.min(requestedCreditCents, availableCreditCents, Math.max(0, totalOrderAmount));
      
      // Calculate how much credit goes to products vs shipping
      const remainingSubtotal = subtotal - discountAmount - giftCardAmount;
      
      if (userCreditAmount <= remainingSubtotal) {
        // Credit fits within product subtotal - apply all via coupon
        creditForProducts = userCreditAmount;
        creditForShipping = 0;
      } else {
        // Credit exceeds product subtotal - split between products and shipping
        creditForProducts = Math.max(0, remainingSubtotal);
        creditForShipping = userCreditAmount - creditForProducts;
        // Reduce shipping cost directly
        shipping = Math.max(0, shipping - creditForShipping);
      }
      
      console.log('Credit calculation:', {
        requestedCredit: userCredit,
        availableCredit,
        subtotal: subtotal / 100,
        shipping: shipping / 100,
        discountAmount: discountAmount / 100,
        giftCardAmount: giftCardAmount / 100,
        userCreditAmount: userCreditAmount / 100,
        creditForProducts: creditForProducts / 100,
        creditForShipping: creditForShipping / 100
      });
    }

    // Build line items with price_data (dynamic products)
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = checkoutItems.map((item) => {
      // Build product name with weight info if applicable
      let productName = item.name;
      if (item.weight_grams) {
        const weightDisplay = item.weight_grams >= 1000 
          ? `${(item.weight_grams / 1000).toFixed(item.weight_grams % 1000 === 0 ? 0 : 2)} Kg`
          : `${item.weight_grams} g`;
        productName = `${item.name} (${weightDisplay})`;
      }
      
      return {
        price_data: {
          currency: "eur",
          product_data: {
            name: productName,
            images: item.image ? [item.image] : [],
            metadata: {
              productId: item.productId,
              size: item.size || "",
              color: item.color || "",
              weight_grams: item.weight_grams?.toString() || "",
            },
          },
          unit_amount: toCents(item.price),
        },
        quantity: item.quantity,
      };
    });

    // Build session config
    // Payment methods enabled in Stripe Dashboard
    // Note: Apple Pay and Google Pay are automatically shown with "card" if device supports them
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      line_items: lineItems,
      mode: "payment",
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      customer_email: customerEmail,
      locale: "it",
      // Payment methods: card (includes Apple/Google Pay), klarna, link, satispay, bancontact, eps, revolut_pay
      payment_method_types: [
        "card",           // Carte + Apple Pay + Google Pay (automatic)
        "klarna",         // Pagamento a rate
        "link",           // Stripe Link (checkout veloce)
        "satispay",       // Italia
        "bancontact",     // Belgio
        "eps",            // Austria
        "revolut_pay",    // Europa
      ],
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: shipping, currency: "eur" },
            display_name: shipping === 0 ? "Spedizione Gratuita" : "Spedizione Standard",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 2 },
              maximum: { unit: "business_day", value: 4 },
            },
          },
        },
      ],
      metadata: {
        userId: user.id,
        giftCardCode: giftCardCode || "",
        giftCardAmount: giftCardAmount.toString(),
        promotionCode: promotionCode || "",
        discountAmount: discountAmount.toString(),
        userCreditAmount: userCreditAmount.toString(),
        // Compressed shipping: only essential fields, abbreviated keys
        shipTo: shippingAddress ? JSON.stringify({
          n: `${shippingAddress.firstName} ${shippingAddress.lastName}`,
          a: shippingAddress.address,
          c: shippingAddress.city,
          p: shippingAddress.postalCode,
          pr: shippingAddress.province,
          ph: shippingAddress.phone
        }) : "",
        // Full cart snapshot is stored in pending_checkout_sessions.
        // Stripe line item product metadata also carries the full productId.
        itemCount: checkoutItems.length.toString(),
      },
    };

    // Log metadata sizes for debugging
    const metadataSizes = Object.entries(sessionConfig.metadata || {}).map(([k, v]) => `${k}: ${String(v).length}`);
    console.log("Metadata sizes:", metadataSizes);

    // Apply discounts using Stripe coupons (created on-the-fly)
    // Note: Coupon only applies to products, shipping reduction is handled above
    const couponDiscount = discountAmount + giftCardAmount + creditForProducts;
    if (couponDiscount > 0) {
      // Build coupon name based on what's applied
      const discountParts: string[] = [];
      if (discountAmount > 0) discountParts.push("Sconto");
      if (giftCardAmount > 0) discountParts.push("Gift Card");
      if (creditForProducts > 0) discountParts.push("Credito");
      
      // Create a one-time coupon for the product discount
      console.log("Creating coupon with amount:", couponDiscount);
      const coupon = await stripe.coupons.create({
        amount_off: couponDiscount,
        currency: "eur",
        duration: "once",
        name: discountParts.join(" + "),
      });
      
      sessionConfig.discounts = [{ coupon: coupon.id }];
    }

    // Create the checkout session
    console.log("Creating Stripe session...");
    const session = await stripe.checkout.sessions.create(sessionConfig);
    console.log("Session created:", session.id);

    const totalAmount = Math.max(
      0,
      subtotal + shipping - discountAmount - giftCardAmount - userCreditAmount
    );

    const { error: pendingError } = await supabaseAdmin
      .from("pending_checkout_sessions")
      .upsert({
        stripe_session_id: session.id,
        user_id: user.id,
        checkout_type: "order",
        status: "created",
        customer_email: customerEmail,
        items: checkoutItems.map((item) => ({
          product_id: item.productId,
          product_name: item.name,
          product_price: item.price,
          unit_price: item.unitPrice ?? item.price,
          quantity: item.quantity,
          size: item.size || "Standard",
          color: item.color || "Fresco",
          image: item.image || "",
          weight_grams: item.weight_grams || null,
          unit_measure: item.weight_grams ? "kg" : "pz",
        })),
        shipping_address: shippingAddress || null,
        subtotal: subtotal / 100,
        discount_amount: discountAmount / 100,
        gift_card_amount: giftCardAmount / 100,
        user_credit_amount: userCreditAmount / 100,
        shipping_cost: shipping / 100,
        total: totalAmount / 100,
        promotion_code: promotionCode ? normalizeCode(promotionCode) : null,
        gift_card_code: giftCardCode ? normalizeCode(giftCardCode).replace(/-/g, "") : null,
        metadata: {
          creditForProducts: creditForProducts / 100,
          creditForShipping: creditForShipping / 100,
          stripeSessionUrl: session.url,
        },
      }, { onConflict: "stripe_session_id" });

    if (pendingError) {
      console.warn("Pending checkout snapshot failed; continuing with Stripe metadata fallback:", pendingError);
    }

    return new Response(JSON.stringify({ 
      sessionId: session.id, 
      url: session.url 
    }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Checkout session error:", error);
    // Log more details about the error
    if (error && typeof error === 'object' && 'raw' in error) {
      console.error("Stripe error details:", JSON.stringify((error as any).raw, null, 2));
    }
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Errore interno del server" 
    }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
