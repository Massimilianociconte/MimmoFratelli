/**
 * Gift Card Email Edge Function
 * Mimmo Fratelli E-commerce Platform
 *
 * Reinvia l'email della gift card al destinatario.
 * Riservata agli admin (per reinvii manuali dal pannello).
 * L'invio automatico al momento dell'acquisto avviene da stripe-webhook /
 * complete-giftcard-purchase tramite il modulo condiviso _shared/email.ts.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendGiftCardEmailTo } from "../_shared/email.ts";
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

    const { giftCardId } = await req.json();
    if (
      typeof giftCardId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(giftCardId)
    ) {
      return new Response(JSON.stringify({ error: "Invalid giftCardId" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    // Get gift card details
    const { data: giftCard, error: giftCardError } = await supabaseAdmin
      .from("gift_cards")
      .select("*")
      .eq("id", giftCardId)
      .single();

    if (giftCardError || !giftCard) {
      return new Response(JSON.stringify({ error: "Gift card not found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    if (!giftCard.recipient_email) {
      return new Response(JSON.stringify({ error: "No recipient email" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const sent = await sendGiftCardEmailTo(giftCard);

    if (!sent) {
      return new Response(JSON.stringify({ error: "Email send failed" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    // Log audit entry
    await supabaseAdmin.from("audit_log").insert({
      user_id: giftCard.purchased_by,
      action: "giftcard_email_sent",
      table_name: "gift_cards",
      record_id: giftCardId,
      new_data: { delivery: "recipient" },
    });

    return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
  } catch (error) {
    console.error("Send gift card email error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
