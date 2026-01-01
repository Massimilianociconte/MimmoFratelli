/**
 * Get Stripe Receipt Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Retrieves the Stripe receipt URL for a completed order
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

// Initialize Stripe with error handling
let stripe: Stripe | null = null;
const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
if (stripeKey) {
  stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
  console.log("[get-stripe-receipt] Stripe initialized successfully");
} else {
  console.error("[get-stripe-receipt] STRIPE_SECRET_KEY not found!");
}

Deno.serve(async (req: Request) => {
  console.log("[get-stripe-receipt] Request received, method:", req.method);
  console.log("[get-stripe-receipt] Origin:", req.headers.get('origin'));
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    console.log("[get-stripe-receipt] Handling OPTIONS preflight");
    return handleCorsPreflightRequest(req);
  }
  
  const corsHeaders = getCorsHeaders(req);

  try {
    // Check if Stripe is initialized
    if (!stripe) {
      console.error("[get-stripe-receipt] Stripe not initialized");
      return new Response(JSON.stringify({ error: "Servizio pagamenti non configurato" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.log("[get-stripe-receipt] No auth header");
      return new Response(JSON.stringify({ error: "Non autorizzato" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Supabase client with user's token
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.log("[get-stripe-receipt] User not authenticated:", userError?.message);
      return new Response(JSON.stringify({ error: "Utente non autenticato" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[get-stripe-receipt] User authenticated:", user.id);

    // Parse request body
    let orderId: string;
    try {
      const body = await req.json();
      orderId = body.orderId;
      console.log("[get-stripe-receipt] Parsed orderId:", orderId);
    } catch (parseError) {
      console.error("[get-stripe-receipt] Failed to parse body:", parseError);
      return new Response(JSON.stringify({ error: "Richiesta non valida" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!orderId) {
      console.log("[get-stripe-receipt] Missing orderId");
      return new Response(JSON.stringify({ error: "ID ordine mancante" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[get-stripe-receipt] Looking up order:", orderId);

    // Get order from database - verify it belongs to the user
    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("id, user_id, payment_id, payment_status, payment_provider")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      console.log("[get-stripe-receipt] Order not found:", orderError?.message);
      return new Response(JSON.stringify({ error: "Ordine non trovato" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[get-stripe-receipt] Order found - payment_id:", order.payment_id, "status:", order.payment_status);

    // Verify order belongs to user
    if (order.user_id !== user.id) {
      console.log("[get-stripe-receipt] Order doesn't belong to user");
      return new Response(JSON.stringify({ error: "Non autorizzato" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check payment status
    if (order.payment_status !== "completed") {
      return new Response(
        JSON.stringify({ error: "Pagamento non completato" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify it's a Stripe payment
    if (order.payment_provider !== "stripe") {
      return new Response(
        JSON.stringify({ error: "Ricevuta disponibile solo per pagamenti Stripe" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get Stripe payment intent ID
    if (!order.payment_id) {
      console.error("No payment_id found for order:", orderId);
      return new Response(
        JSON.stringify({ error: "ID pagamento Stripe non trovato. La ricevuta non è disponibile per questo ordine." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Retrieving payment intent:", order.payment_id);

    // Retrieve payment intent from Stripe
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(
        order.payment_id,
        { expand: ["latest_charge"] }
      );
    } catch (stripeError) {
      console.error("Stripe API error:", stripeError);
      return new Response(
        JSON.stringify({ error: "Errore nel recupero dei dati da Stripe" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get receipt URL from the charge
    const charge = paymentIntent.latest_charge as Stripe.Charge;
    const receiptUrl = charge?.receipt_url;

    if (!receiptUrl) {
      return new Response(
        JSON.stringify({ error: "Ricevuta non disponibile" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ receiptUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error getting receipt:", error);
    const errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
    console.error("Error details:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Errore nel recupero della ricevuta", details: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
