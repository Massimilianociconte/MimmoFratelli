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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { 
      items, 
      successUrl, 
      cancelUrl, 
      customerEmail, 
      giftCardCode, 
      promotionCode,
      shippingAddress,
      userCredit 
    }: CheckoutRequest = await req.json();

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: "Carrello vuoto" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate subtotal in cents
    const subtotal = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
    
    // Fetch promotion and gift card in parallel for better performance
    const [promoResult, giftCardResult] = await Promise.all([
      promotionCode 
        ? supabaseClient
            .from("promotions")
            .select("discount_type, discount_value")
            .eq("code", promotionCode.toUpperCase())
            .eq("is_active", true)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      giftCardCode
        ? supabaseClient
            .from("gift_cards")
            .select("balance")
            .eq("code", giftCardCode.toUpperCase())
            .eq("is_active", true)
            .maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    // Calculate discount from promotion
    let discountAmount = 0;
    const promo = promoResult.data;
    if (promo) {
      if (promo.discount_type === "percentage") {
        discountAmount = Math.round((subtotal * promo.discount_value) / 100);
      } else {
        discountAmount = Math.round(promo.discount_value * 100);
      }
    }

    // Calculate gift card discount
    let giftCardAmount = 0;
    const giftCard = giftCardResult.data;
    if (giftCard && giftCard.balance > 0) {
      giftCardAmount = Math.min(Math.round(giftCard.balance * 100), subtotal - discountAmount);
    }

    // Calculate base shipping (free over €50)
    const FREE_SHIPPING_THRESHOLD = 5000; // €50 in cents
    const SHIPPING_COST = 590; // €5.90 in cents (same as frontend)
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
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((item) => {
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
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      };
    });

    // Build session config
    // Note: Removing payment_method_types to let Stripe automatically show all enabled methods
    // from the dashboard (card, klarna, paypal, google_pay, apple_pay, etc.)
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      line_items: lineItems,
      mode: "payment",
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      customer_email: customerEmail,
      locale: "it",
      // Enable automatic payment methods based on dashboard settings
      automatic_payment_methods: {
        enabled: true,
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
        // Compressed items: only productId, quantity, price, weight - max 500 chars
        itemsCompact: JSON.stringify(items.map(i => ({
          p: i.productId.slice(0, 8), // Short product ID (first 8 chars)
          q: i.quantity,
          pr: i.price,
          w: i.weight_grams || 0
        }))),
        // Store full item count for reference
        itemCount: items.length.toString(),
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
      const coupon = await stripe.coupons.create({
        amount_off: couponDiscount,
        currency: "eur",
        duration: "once",
        name: discountParts.join(" + "),
      });
      
      sessionConfig.discounts = [{ coupon: coupon.id }];
    }

    // Create the checkout session
    const session = await stripe.checkout.sessions.create(sessionConfig);

    return new Response(JSON.stringify({ 
      sessionId: session.id, 
      url: session.url 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Checkout session error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Errore interno del server" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
