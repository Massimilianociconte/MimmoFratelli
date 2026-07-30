/**
 * Order Email Notification Edge Function
 * Mimmo Fratelli E-commerce Platform
 *
 * Invia email di notifica per i cambi di stato ordine (processing/shipped/delivered).
 * Riservata agli admin (invocata dal pannello admin al cambio stato).
 * La conferma d'acquisto iniziale viene inviata direttamente da stripe-webhook /
 * complete-order-purchase tramite il modulo condiviso _shared/email.ts.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendOrderConfirmationEmail,
  sendOrderShippedEmail,
  sendOrderDeliveredEmail,
} from "../_shared/email.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  const jsonHeaders = { ...getCorsHeaders(req), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Solo gli admin possono invocare questa funzione (evita spam/abusi)
    const supabaseUser = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } }
    );

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const { orderId, status } = await req.json();

    if (
      typeof orderId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId) ||
      !["processing", "shipped", "delivered"].includes(status)
    ) {
      return new Response(JSON.stringify({ error: "Invalid orderId or status" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    // Ordine con articoli (l'email include il riepilogo)
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    // Email del cliente da auth.users (profiles non ha la colonna email)
    let userEmail: string | null = null;
    if (order.user_id) {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(order.user_id);
      userEmail = authUser?.user?.email || null;
    }

    if (!userEmail) {
      return new Response(JSON.stringify({ error: "No user email" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    let sent = false;
    if (status === "processing") {
      sent = await sendOrderConfirmationEmail(userEmail, order);
    } else if (status === "shipped") {
      sent = await sendOrderShippedEmail(userEmail, order);
    } else if (status === "delivered") {
      sent = await sendOrderDeliveredEmail(userEmail, order);
    }

    if (!sent) {
      return new Response(JSON.stringify({ error: "Email send failed" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    // Log audit entry
    await supabaseAdmin.from("audit_log").insert({
      user_id: order.user_id,
      action: "email_sent",
      table_name: "orders",
      record_id: orderId,
      new_data: { status },
    });

    return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
  } catch (error) {
    console.error("Send email error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
