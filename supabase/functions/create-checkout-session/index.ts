/**
 * Stripe Checkout Session Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Creates dynamic checkout sessions without pre-created Stripe products
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.4.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildTrustedSiteUrl,
  CHECKOUT_TTL_SECONDS,
  getStripe,
  PaymentInputError,
  publicPaymentError,
  validateShippingAddress,
} from "../_shared/payment.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const TERMS_VERSION = "2026-07-30";
const PRIVACY_VERSION = "2026-07-30";

/**
 * Builds a short, deterministic idempotency key from the request payload plus a
 * coarse (per-minute) time bucket. Dedupes rapid double-clicks / network retries
 * of the SAME checkout without blocking a legitimate later repeat purchase.
 */
async function buildIdempotencyKey(parts: (string | number)[]): Promise<string> {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const raw = `${parts.join("|")}|${minuteBucket}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  num_items: number | null;
  food_information_required: boolean;
  food_information_verified_at: string | null;
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
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 50) {
    return { error: "Numero di articoli non valido" };
  }

  const productIds = [...new Set(rawItems.map((item) => item.productId).filter(Boolean))];

  if (productIds.length === 0) {
    return { error: "Prodotti non validi" };
  }

  const { data: products, error } = await supabaseAdmin
    .from("products")
    .select(
      "id, name, price, sale_price, images, is_active, category_id, num_items, " +
      "food_information_required, food_information_verified_at"
    )
    .in("id", productIds);

  if (error) {
    console.error("Product repricing error:", error);
    return { error: "Errore nella verifica dei prodotti" };
  }

  const productMap = new Map<string, ProductRecord>(
    (products || []).map((product: ProductRecord) => [product.id, product])
  );

  // Stock a peso: carica le disponibilità weight_inventory dei prodotti richiesti
  const weightStock = new Map<string, number>();
  const hasWeightItems = rawItems.some((item) => item.weight_grams);
  if (hasWeightItems) {
    const { data: weightRows, error: weightError } = await supabaseAdmin
      .from("weight_inventory")
      .select("product_id, weight_grams, quantity")
      .in("product_id", productIds);

    if (weightError) {
      console.error("Weight inventory lookup error:", weightError);
      return { error: "Errore nella verifica della disponibilità" };
    }

    for (const row of weightRows || []) {
      weightStock.set(`${row.product_id}:${row.weight_grams}`, Number(row.quantity));
    }
  }

  const serverItems: CartItem[] = [];
  // Quantità aggregate richieste per validare lo stock complessivo
  const requestedByWeight = new Map<string, number>();
  const requestedByProduct = new Map<string, number>();

  for (const item of rawItems) {
    const product = productMap.get(item.productId);
    const quantity = Number(item.quantity);
    const weightGrams = item.weight_grams ? Number(item.weight_grams) : null;

    if (!product || !product.is_active) {
      return { error: "Uno o più prodotti non sono più disponibili" };
    }

    if (product.food_information_required && !product.food_information_verified_at) {
      return {
        error:
          `"${product.name}" non è ancora acquistabile online: ` +
          "le informazioni alimentari obbligatorie devono essere verificate",
      };
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return { error: "Quantità prodotto non valida" };
    }

    if (weightGrams !== null && (!Number.isInteger(weightGrams) || weightGrams <= 0)) {
      return { error: "Formato peso prodotto non valido" };
    }

    // Validazione stock server-side
    if (weightGrams !== null) {
      const key = `${item.productId}:${weightGrams}`;
      const requested = (requestedByWeight.get(key) || 0) + quantity;
      requestedByWeight.set(key, requested);
      const available = weightStock.get(key);
      if (available === undefined) {
        return { error: `Variante non disponibile per "${product.name}"` };
      }
      if (requested > available) {
        return { error: `Disponibilità insufficiente per "${product.name}"` };
      }
    } else if (product.num_items !== null && product.num_items !== undefined) {
      const requested = (requestedByProduct.get(item.productId) || 0) + quantity;
      requestedByProduct.set(item.productId, requested);
      if (requested > Number(product.num_items)) {
        return { error: `Disponibilità insufficiente per "${product.name}"` };
      }
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

  let supabaseAdmin: any = null;
  let reservationId: string | null = null;
  let stripeSession: Stripe.Checkout.Session | null = null;

  try {
    const stripe = getStripe();
    
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return jsonResponse(req, 401, { error: "Devi effettuare il login" });
    }

    const body = await req.json() as CheckoutRequest;
    
    const { 
      items, 
      giftCardCode, 
      promotionCode,
      shippingAddress,
      userCredit 
    }: CheckoutRequest = body;

    const validatedShippingAddress = validateShippingAddress(shippingAddress);
    const customerEmail = user.email;
    if (!customerEmail) throw new PaymentInputError("Email account non disponibile");

    const normalizedPromotionCode = normalizeCode(promotionCode);
    const normalizedGiftCardCode = normalizeCode(giftCardCode).replace(/-/g, "");
    const giftCardLookupCodes = [
      normalizedGiftCardCode,
      normalizedGiftCardCode.length === 12
        ? normalizedGiftCardCode.replace(/^(.{4})(.{4})(.{4})$/, "$1-$2-$3")
        : normalizedGiftCardCode,
    ];
    if (normalizedPromotionCode.length > 64 || normalizedGiftCardCode.length > 64) {
      throw new PaymentInputError("Codice sconto non valido");
    }

    const requestedUserCredit = Number(userCredit || 0);
    if (
      !Number.isFinite(requestedUserCredit) ||
      requestedUserCredit < 0 ||
      requestedUserCredit > 10_000 ||
      Math.abs(Math.round(requestedUserCredit * 100) - requestedUserCredit * 100) > 1e-6
    ) {
      throw new PaymentInputError("Importo credito non valido");
    }

    supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Opportunistic cleanup is bounded and uses SKIP LOCKED. Stripe expiry
    // webhooks remain the primary release mechanism.
    const { error: cleanupError } = await supabaseAdmin.rpc(
      "release_expired_checkout_reservations",
      { p_limit: 25 },
    );
    if (cleanupError) {
      console.warn("Expired checkout reservation cleanup failed:", cleanupError.message);
    }

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
            .eq("code", normalizedPromotionCode)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      giftCardCode
        ? supabaseAdmin
            .from("gift_cards")
            .select("amount, balance, remaining_balance, is_active, is_redeemed, expires_at")
            .in("code", [...new Set(giftCardLookupCodes)])
            .limit(1)
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

    // Verify and calculate user credit. Credits apply to merchandise only:
    // Stripe amount-off coupons do not discount shipping.
    let userCreditAmount = 0;
    let creditForProducts = 0;
    
    if (requestedUserCredit > 0) {
      const { data: creditData, error: creditError } = await supabaseAdmin
        .from("user_credits")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle();

      if (creditError) {
        throw new Error(`User credit lookup failed: ${creditError.message}`);
      }
      
      const requestedCreditCents = toCents(requestedUserCredit);
      const availableCreditCents = toCents(Number(creditData?.balance || 0));
      const remainingSubtotal = subtotal - discountAmount - giftCardAmount;

      userCreditAmount = Math.min(
        requestedCreditCents,
        availableCreditCents,
        Math.max(0, remainingSubtotal),
      );
      creditForProducts = userCreditAmount;
    }

    // The reservation key also becomes the Stripe idempotency key. Database
    // value is locked before any externally payable session is opened.
    const idempotencyKey = await buildIdempotencyKey([
      user.id,
      subtotal,
      shipping,
      discountAmount,
      giftCardAmount,
      userCreditAmount,
      normalizedPromotionCode,
      normalizedGiftCardCode,
      checkoutItems
        .map((item) =>
          `${item.productId}:${item.quantity}:${item.size || ""}:${item.color || ""}:${item.weight_grams || ""}`
        )
        .join(","),
    ]);

    const { data: reservation, error: reservationError } = await supabaseAdmin.rpc(
      "reserve_checkout_value",
      {
        p_user_id: user.id,
        p_reservation_key: idempotencyKey,
        p_credit_amount: userCreditAmount / 100,
        p_gift_card_code: normalizedGiftCardCode || null,
        p_gift_card_amount: giftCardAmount / 100,
        p_promotion_code: normalizedPromotionCode || null,
        p_subtotal: subtotal / 100,
        p_items: checkoutItems.map((item) => ({
          product_id: item.productId,
          quantity: item.quantity,
          weight_grams: item.weight_grams ?? null,
        })),
      },
    );

    if (reservationError || !reservation?.success || !reservation?.reservation_id) {
      console.warn(
        "Checkout value reservation rejected:",
        reservationError?.code || reservation?.reason || "unknown",
      );
      throw new PaymentInputError(
        "Saldo, gift card o promozione sono cambiati: aggiorna il checkout e riprova",
        409,
      );
    }
    const checkoutReservationId = String(reservation.reservation_id);
    reservationId = checkoutReservationId;

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

    const successUrl = buildTrustedSiteUrl(req, "/checkout-success.html");
    const cancelUrl = buildTrustedSiteUrl(req, "/checkout-cancel.html");

    // Payment methods are selected dynamically from the Stripe Dashboard.
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      line_items: lineItems,
      mode: "payment",
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      customer_email: customerEmail,
      client_reference_id: checkoutReservationId,
      locale: "it",
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
      consent_collection: {
        terms_of_service: "required",
      },
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
      payment_intent_data: {
        metadata: {
          checkoutReservationId,
          userId: user.id,
        },
      },
      metadata: {
        userId: user.id,
        checkoutReservationId,
        giftCardAmount: giftCardAmount.toString(),
        discountAmount: discountAmount.toString(),
        userCreditAmount: userCreditAmount.toString(),
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        // Full cart snapshot is stored in pending_checkout_sessions.
        // Stripe line item product metadata also carries the full productId.
        itemCount: checkoutItems.length.toString(),
      },
    };

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
      const coupon = await stripe.coupons.create(
        {
          amount_off: couponDiscount,
          currency: "eur",
          duration: "once",
          name: discountParts.join(" + "),
          max_redemptions: 1,
          metadata: {
            checkoutReservationId,
          },
        },
        { idempotencyKey: `coupon_${idempotencyKey}` }
      );
      
      sessionConfig.discounts = [{ coupon: coupon.id }];
    }

    // Create the checkout session
    const session = await stripe.checkout.sessions.create(sessionConfig, {
      idempotencyKey: `session_${idempotencyKey}`,
    });
    stripeSession = session;

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
        shipping_address: validatedShippingAddress,
        subtotal: subtotal / 100,
        discount_amount: discountAmount / 100,
        gift_card_amount: giftCardAmount / 100,
        user_credit_amount: userCreditAmount / 100,
        shipping_cost: shipping / 100,
        total: totalAmount / 100,
        promotion_code: normalizedPromotionCode || null,
        gift_card_code: normalizedGiftCardCode || null,
        metadata: {
          creditForProducts: creditForProducts / 100,
          checkoutReservationId,
        },
      }, { onConflict: "stripe_session_id" });

    if (pendingError) {
      throw new Error(`Pending checkout snapshot failed: ${pendingError.message}`);
    }

    const { data: binding, error: bindingError } = await supabaseAdmin.rpc(
      "bind_checkout_value_reservation",
      {
        p_reservation_id: checkoutReservationId,
        p_stripe_session_id: session.id,
      },
    );

    if (bindingError || !binding?.success) {
      throw new Error(`Checkout reservation binding failed: ${bindingError?.message || "unknown error"}`);
    }

    return new Response(JSON.stringify({ 
      sessionId: session.id, 
      url: session.url 
    }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      "Checkout session failed:",
      error instanceof Error ? error.message : "unknown error",
    );

    if (stripeSession?.id) {
      try {
        if (stripeSession.status === "open") {
          await getStripe().checkout.sessions.expire(stripeSession.id);
        }
      } catch (expireError) {
        console.error(
          "Stripe session cleanup failed:",
          expireError instanceof Error ? expireError.message : "unknown error",
        );
      }
    }

    if (supabaseAdmin && reservationId) {
      const { error: releaseError } = await supabaseAdmin.rpc(
        "release_checkout_value_reservation",
        {
          p_reservation_id: reservationId,
          p_reason: "checkout_session_creation_failed",
        },
      );
      if (releaseError) {
        console.error("Checkout reservation cleanup failed:", releaseError.message);
      }
    }

    const publicError = publicPaymentError(error);
    return jsonResponse(req, publicError.status, { error: publicError.message });
  }
});
