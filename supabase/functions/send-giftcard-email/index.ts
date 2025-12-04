/**
 * Gift Card Email Delivery Edge Function
 * Avenue M. E-commerce Platform
 * 
 * Sends gift card codes to recipients via email
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "Avenue M. <noreply@avenuem.it>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const templateStyles: Record<string, { bgColor: string; textColor: string }> = {
  elegant: { bgColor: "#1a1a1a", textColor: "#ffffff" },
  minimal: { bgColor: "#f5f5f5", textColor: "#333333" },
  festive: { bgColor: "#c41e3a", textColor: "#ffffff" },
  birthday: { bgColor: "#ff69b4", textColor: "#ffffff" },
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

    const { giftCardId } = await req.json();

    // Get gift card details
    const { data: giftCard, error: giftCardError } = await supabaseAdmin
      .from("gift_cards")
      .select("*")
      .eq("id", giftCardId)
      .single();

    if (giftCardError || !giftCard) {
      return new Response(JSON.stringify({ error: "Gift card not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!giftCard.recipient_email) {
      return new Response(JSON.stringify({ error: "No recipient email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const style = templateStyles[giftCard.template] || templateStyles.elegant;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Georgia', serif; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; }
          .card { 
            background: ${style.bgColor}; 
            color: ${style.textColor}; 
            padding: 40px; 
            text-align: center;
            border-radius: 12px;
          }
          .logo { font-size: 28px; font-weight: 300; letter-spacing: 2px; margin-bottom: 20px; }
          .title { font-size: 24px; margin-bottom: 10px; }
          .amount { font-size: 48px; font-weight: bold; margin: 20px 0; }
          .code { 
            background: rgba(255,255,255,0.1); 
            padding: 15px 30px; 
            border-radius: 8px; 
            font-size: 24px; 
            letter-spacing: 3px;
            margin: 20px 0;
            display: inline-block;
          }
          .message { 
            font-style: italic; 
            margin: 20px 0; 
            padding: 20px;
            border-top: 1px solid rgba(255,255,255,0.2);
            border-bottom: 1px solid rgba(255,255,255,0.2);
          }
          .from { margin-top: 20px; font-size: 14px; }
          .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="logo">Avenue M.</div>
            <div class="title">Gift Card</div>
            <div class="amount">€${giftCard.amount.toFixed(2)}</div>
            <div class="code">${giftCard.code}</div>
            ${giftCard.message ? `<div class="message">"${giftCard.message}"</div>` : ""}
            ${giftCard.sender_name ? `<div class="from">Da: ${giftCard.sender_name}</div>` : ""}
          </div>
          <div class="footer">
            <p>Utilizza questo codice su avenuem.it al momento del checkout.</p>
            <p>La Gift Card non ha scadenza.</p>
            <p>© 2025 Avenue M. Tutti i diritti riservati.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email via Resend
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: giftCard.recipient_email,
        subject: `${giftCard.sender_name || "Qualcuno"} ti ha inviato una Gift Card Avenue M.!`,
        html: emailHtml,
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

    // Update gift card as sent
    await supabaseAdmin
      .from("gift_cards")
      .update({ email_sent: true, email_sent_at: new Date().toISOString() })
      .eq("id", giftCardId);

    // Log audit entry
    await supabaseAdmin.from("audit_log").insert({
      action: "giftcard_email_sent",
      details: { giftCardId, recipientEmail: giftCard.recipient_email },
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Send gift card email error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
