/**
 * Gift Card Checkout Session Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Creates Stripe checkout sessions for gift card purchases
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.4.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildTrustedSiteUrl,
  CHECKOUT_TTL_SECONDS,
  getStripe,
  normalizeEmail,
  normalizeMoney,
  normalizeText,
  publicPaymentError,
} from "../_shared/payment.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const TERMS_VERSION = "2026-07-30";
const PRIVACY_VERSION = "2026-07-30";

/**
 * Deterministic idempotency key from the request payload plus a coarse
 * (per-minute) time bucket. Dedupes double-clicks / network retries of the SAME
 * gift-card purchase without blocking a legitimate later repeat purchase.
 */
async function buildIdempotencyKey(parts: (string | number)[]): Promise<string> {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const raw = `${parts.join("|")}|${minuteBucket}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface GiftCardRequest {
  amount: number;
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  message?: string;
  template?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

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
      return new Response(JSON.stringify({ error: "Devi effettuare il login" }), {
        status: 401,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as GiftCardRequest;
    const amount = normalizeMoney(body.amount, 10, 500);
    const recipientName = normalizeText(body.recipientName, "Nome destinatario", 120);
    const recipientEmail = normalizeEmail(body.recipientEmail, "Email destinatario");
    const senderName = normalizeText(body.senderName, "Nome mittente", 120);
    const message = normalizeText(body.message, "Messaggio", 500, false);
    const template = normalizeText(body.template || "elegant", "Stile", 40);
    const successUrl = buildTrustedSiteUrl(
      req,
      "/checkout-success.html",
      { type: "giftcard" },
    );
    const cancelUrl = buildTrustedSiteUrl(
      req,
      "/settings.html",
      { tab: "giftcards", cancelled: "true" },
    );

    // Create Stripe checkout session for gift card.
    // BNPL methods are intentionally disabled for stored-value products.
    const idempotencyKey = await buildIdempotencyKey([
      user.id,
      Math.round(amount * 100),
      recipientEmail,
      senderName,
      message,
      template,
    ]);
    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: [
        "card",           // Carte + Apple Pay + Google Pay
        "link",           // Stripe Link
        "satispay",       // Italia
      ],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Gift Card Mimmo Fratelli - €${amount}`,
              description: "Gift card digitale",
              images: ["https://www.mimmofratelli.com/Images/giftcard-preview.png"],
              metadata: {
                type: "gift_card",
              },
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${successUrl}${successUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      customer_email: user.email,
      locale: "it",
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
      consent_collection: {
        terms_of_service: "required",
      },
      client_reference_id: idempotencyKey,
      payment_intent_data: {
        metadata: {
          checkoutType: "gift_card",
          userId: user.id,
        },
      },
      metadata: {
        type: "gift_card",
        userId: user.id,
        amount: amount.toString(),
        template,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      },
    };

    const configuredPaymentMethods = Deno.env.get(
      "STRIPE_GIFTCARD_PAYMENT_METHOD_CONFIGURATION",
    );
    if (configuredPaymentMethods) {
      delete sessionConfig.payment_method_types;
      sessionConfig.payment_method_configuration = configuredPaymentMethods;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig, {
      idempotencyKey: `gc_session_${idempotencyKey}`,
    });
    stripeSession = session;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { error: pendingError } = await supabaseAdmin
      .from("pending_checkout_sessions")
      .upsert({
        stripe_session_id: session.id,
        user_id: user.id,
        checkout_type: "gift_card",
        status: "created",
        customer_email: user.email || recipientEmail,
        items: [{
          product_id: null,
          product_name: "Gift Card Mimmo Fratelli",
          product_price: amount,
          quantity: 1,
          type: "gift_card",
        }],
        subtotal: amount,
        discount_amount: 0,
        gift_card_amount: 0,
        user_credit_amount: 0,
        shipping_cost: 0,
        total: amount,
        metadata: {
          amount,
          recipientName,
          recipientEmail,
          senderName,
          message,
          template,
        },
      }, { onConflict: "stripe_session_id" });

    if (pendingError) {
      throw new Error(`Pending gift-card checkout snapshot failed: ${pendingError.message}`);
    }

    return new Response(JSON.stringify({ 
      sessionId: session.id, 
      url: session.url 
    }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(
      "Gift-card checkout failed:",
      error instanceof Error ? error.message : "unknown error",
    );

    if (stripeSession?.id && stripeSession.status === "open") {
      try {
        await getStripe().checkout.sessions.expire(stripeSession.id);
      } catch (expireError) {
        console.error(
          "Gift-card Stripe session cleanup failed:",
          expireError instanceof Error ? expireError.message : "unknown error",
        );
      }
    }

    const publicError = publicPaymentError(error);
    return new Response(JSON.stringify({ error: publicError.message }), {
      status: publicError.status,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
