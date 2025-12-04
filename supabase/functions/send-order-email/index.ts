/**
 * Order Email Notification Edge Function
 * Avenue M. E-commerce Platform
 * 
 * Sends email notifications for order status changes
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "Avenue M. <noreply@avenuem.it>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const emailTemplates: Record<string, { subject: string; body: (order: any) => string }> = {
  processing: {
    subject: "Ordine Confermato - Avenue M.",
    body: (order) => `
      <h1>Grazie per il tuo ordine!</h1>
      <p>Ciao ${order.shipping_address?.firstName || ""},</p>
      <p>Il tuo ordine #${order.id.slice(0, 8)} è stato confermato e sarà presto elaborato.</p>
      <p><strong>Totale:</strong> €${order.total_amount?.toFixed(2)}</p>
      <p>Ti invieremo un'email quando il tuo ordine sarà spedito.</p>
      <p>Grazie per aver scelto Avenue M.!</p>
    `,
  },
  shipped: {
    subject: "Ordine Spedito - Avenue M.",
    body: (order) => `
      <h1>Il tuo ordine è in viaggio!</h1>
      <p>Ciao ${order.shipping_address?.firstName || ""},</p>
      <p>Il tuo ordine #${order.id.slice(0, 8)} è stato spedito.</p>
      ${order.tracking_number ? `
        <p><strong>Corriere:</strong> ${order.courier?.toUpperCase()}</p>
        <p><strong>Numero Tracking:</strong> ${order.tracking_number}</p>
      ` : ""}
      <p>Grazie per aver scelto Avenue M.!</p>
    `,
  },
  delivered: {
    subject: "Ordine Consegnato - Avenue M.",
    body: (order) => `
      <h1>Ordine Consegnato!</h1>
      <p>Ciao ${order.shipping_address?.firstName || ""},</p>
      <p>Il tuo ordine #${order.id.slice(0, 8)} è stato consegnato.</p>
      <p>Speriamo che tu sia soddisfatto del tuo acquisto!</p>
      <p>Grazie per aver scelto Avenue M.!</p>
    `,
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { orderId, status } = await req.json();

    // Get order with user info
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*, profiles(email)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const template = emailTemplates[status];
    if (!template) {
      return new Response(JSON.stringify({ error: "Unknown status" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userEmail = order.profiles?.email;
    if (!userEmail) {
      return new Response(JSON.stringify({ error: "No user email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send email via Resend
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: userEmail,
        subject: template.subject,
        html: template.body(order),
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("Email send error:", errorText);
      return new Response(JSON.stringify({ error: "Email send failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log audit entry
    await supabaseAdmin.from("audit_log").insert({
      user_id: order.user_id,
      action: "email_sent",
      details: { orderId, status, email: userEmail },
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Send email error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
