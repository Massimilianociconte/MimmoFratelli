/**
 * Authenticated, first-party gift-card QR generation.
 *
 * The QR token is a bearer credential. It must never be sent to a public QR
 * generator or included in a third-party image URL.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "npm:qrcode@1.5.4";
import { getCorsHeaders } from "../_shared/cors.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  const corsHeaders = getCorsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Metodo non consentito" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) {
      throw new Response(JSON.stringify({ error: "Autenticazione richiesta" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Configurazione Supabase incompleta");
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      throw new Response(JSON.stringify({ error: "Sessione non valida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await request.json() as { qrToken?: unknown; size?: unknown };
    const qrToken = typeof body.qrToken === "string" ? body.qrToken.trim() : "";
    const requestedSize = Number(body.size);
    const size = Number.isFinite(requestedSize)
      ? Math.min(320, Math.max(80, Math.round(requestedSize)))
      : 200;

    if (!UUID_PATTERN.test(qrToken)) {
      throw new Response(JSON.stringify({ error: "Token QR non valido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: giftCard, error: giftCardError } = await adminClient
      .from("gift_cards")
      .select("purchased_by, redeemed_by")
      .eq("qr_code_token", qrToken)
      .maybeSingle();
    if (giftCardError) throw giftCardError;
    if (!giftCard) {
      throw new Response(JSON.stringify({ error: "Gift card non trovata" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin");
    if (adminError) throw adminError;

    const canView =
      giftCard.purchased_by === user.id ||
      giftCard.redeemed_by === user.id ||
      isAdmin === true;
    if (!canView) {
      throw new Response(JSON.stringify({ error: "Accesso non consentito" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const configuredSiteUrl = Deno.env.get("SITE_URL") || "https://www.mimmofratelli.com";
    const siteUrl = new URL(configuredSiteUrl);
    const redeemUrl = new URL("/redeem.html", siteUrl);
    redeemUrl.searchParams.set("token", qrToken);

    const svg = await QRCode.toString(redeemUrl.href, {
      type: "svg",
      width: size,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#173126",
        light: "#FFFFFF",
      },
    });

    return new Response(JSON.stringify({ svg }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(
      "Gift-card QR generation failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return new Response(JSON.stringify({ error: "Impossibile generare il QR" }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }
});
