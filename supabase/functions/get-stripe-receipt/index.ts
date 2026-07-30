/**
 * Returns the Stripe-hosted receipt for one of the authenticated user's paid
 * orders. No payment identifiers or provider errors are exposed to the client.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@20.4.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStripe, PaymentInputError, publicPaymentError } from "../_shared/payment.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

function response(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request),
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(request) });
  }

  try {
    const authorization = request.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_ANON_KEY") || "",
      { global: { headers: { Authorization: authorization } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return response(request, { error: "Utente non autenticato" }, 401);

    const { orderId } = await request.json();
    if (
      typeof orderId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)
    ) {
      throw new PaymentInputError("ID ordine non valido");
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("user_id, payment_id, payment_status, payment_provider")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return response(request, { error: "Ordine non trovato" }, 404);
    }
    if (order.user_id !== user.id) {
      return response(request, { error: "Non autorizzato" }, 403);
    }
    if (
      order.payment_status !== "completed" ||
      order.payment_provider !== "stripe" ||
      !order.payment_id
    ) {
      throw new PaymentInputError("Ricevuta non disponibile per questo ordine", 409);
    }
    if (order.payment_id.startsWith("checkout_session:")) {
      throw new PaymentInputError(
        "Nessuna ricevuta Stripe per un ordine coperto interamente da credito o sconti",
        409,
      );
    }

    const paymentIntent = await getStripe().paymentIntents.retrieve(
      order.payment_id,
      { expand: ["latest_charge"] },
    );
    const latestCharge = paymentIntent.latest_charge;
    const charge = typeof latestCharge === "object" && latestCharge !== null
      ? latestCharge as Stripe.Charge
      : null;

    if (!charge?.receipt_url) {
      return response(request, { error: "Ricevuta non disponibile" }, 404);
    }

    return response(request, { receiptUrl: charge.receipt_url });
  } catch (error) {
    console.error(
      "Stripe receipt lookup failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    const publicError = publicPaymentError(error);
    return response(request, { error: publicError.message }, publicError.status);
  }
});
