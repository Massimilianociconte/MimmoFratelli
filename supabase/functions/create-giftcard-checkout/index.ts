/**
 * Gift Card Checkout Session Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Creates Stripe checkout sessions for gift card purchases
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

interface GiftCardRequest {
  amount: number;
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  message?: string;
  template?: string;
  successUrl: string;
  cancelUrl: string;
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
      return new Response(JSON.stringify({ error: "Devi effettuare il login" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { 
      amount, 
      recipientName, 
      recipientEmail, 
      senderName, 
      message,
      template,
      successUrl, 
      cancelUrl 
    }: GiftCardRequest = await req.json();

    console.log("Gift card checkout request:", { amount, recipientName, recipientEmail, senderName });

    // Validation
    if (!amount || amount < 10 || amount > 500) {
      return new Response(JSON.stringify({ error: "Importo non valido (min €10, max €500)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!recipientName || !recipientEmail || !senderName) {
      return new Response(JSON.stringify({ error: "Compila tutti i campi obbligatori" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Stripe checkout session for gift card
    // Enable automatic payment methods based on dashboard settings
    const session = await stripe.checkout.sessions.create({
      automatic_payment_methods: {
        enabled: true,
      },
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Gift Card Mimmo Fratelli - €${amount}`,
              description: `Regalo per ${recipientName}`,
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
      metadata: {
        type: "gift_card",
        userId: user.id,
        amount: amount.toString(),
        recipientName,
        recipientEmail,
        senderName,
        message: message || "",
        template: template || "elegant",
      },
    });

    return new Response(JSON.stringify({ 
      sessionId: session.id, 
      url: session.url 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Gift card checkout error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Errore interno del server" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
