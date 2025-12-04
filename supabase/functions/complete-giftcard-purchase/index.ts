/**
 * Complete Gift Card Purchase Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Verifies Stripe checkout session and creates gift card if payment completed
 * This is a fallback for when the webhook doesn't work
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

function generateGiftCardCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 14; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MF-${timestamp}-${random}`;
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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Devi effettuare il login" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { sessionId } = await req.json();
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Session ID mancante" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retrieve the Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    // Verify payment is complete
    if (session.payment_status !== 'paid') {
      return new Response(JSON.stringify({ error: "Pagamento non completato" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify this is a gift card purchase
    if (session.metadata?.type !== 'gift_card') {
      return new Response(JSON.stringify({ error: "Sessione non valida per gift card" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the user matches
    if (session.metadata?.userId !== user.id) {
      return new Response(JSON.stringify({ error: "Utente non autorizzato" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if gift card already exists for this payment
    const paymentIntentId = session.payment_intent as string;
    const { data: existingOrder } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('payment_id', paymentIntentId)
      .maybeSingle();

    if (existingOrder) {
      // Gift card already created, fetch it
      const { data: existingGiftCard } = await supabaseAdmin
        .from('gift_cards')
        .select('*')
        .eq('purchased_by', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingGiftCard) {
        return new Response(JSON.stringify({ 
          success: true, 
          giftCard: existingGiftCard,
          alreadyCreated: true
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Create the gift card
    const metadata = session.metadata!;
    const amount = parseFloat(metadata.amount);

    // Generate unique code
    let code = generateGiftCardCode();
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await supabaseAdmin
        .from('used_gift_card_codes')
        .select('code')
        .eq('code', code)
        .maybeSingle();
      
      if (!existing) break;
      code = generateGiftCardCode();
      attempts++;
    }

    // Generate QR token
    const qrToken = crypto.randomUUID();

    // Get user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .single();

    // Create the gift card
    const { data: giftCard, error: gcError } = await supabaseAdmin
      .from('gift_cards')
      .insert({
        code: code,
        qr_code_token: qrToken,
        amount: amount,
        balance: amount,
        remaining_balance: amount,
        recipient_name: metadata.recipientName,
        recipient_email: metadata.recipientEmail,
        sender_name: metadata.senderName,
        message: metadata.message || null,
        template: metadata.template || 'elegant',
        purchased_by: user.id,
        purchaser_first_name: profile?.first_name || metadata.senderName.split(' ')[0],
        purchaser_last_name: profile?.last_name || metadata.senderName.split(' ').slice(1).join(' ') || '',
        is_active: true,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (gcError) {
      console.error('Gift card creation error:', gcError);
      return new Response(JSON.stringify({ error: "Errore nella creazione della gift card" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Add code to blacklist and create order record in parallel
    const orderNumber = generateOrderNumber();
    await Promise.all([
      supabaseAdmin
        .from('used_gift_card_codes')
        .insert({
          code: code,
          gift_card_id: giftCard.id,
          reason: 'generated'
        }),
      supabaseAdmin
        .from('orders')
        .insert({
          user_id: user.id,
          order_number: orderNumber,
          status: 'confirmed',
          subtotal: amount,
          discount: 0,
          shipping_cost: 0,
          total: amount,
          shipping_address: { type: 'digital', note: 'Gift Card - Consegna digitale' },
          payment_provider: 'stripe',
          payment_id: paymentIntentId,
          payment_status: 'completed',
          notes: `Gift Card per ${metadata.recipientName} (${metadata.recipientEmail})`,
        })
    ]);

    console.log(`Gift card ${code} created successfully for user ${user.id}, amount: €${amount}`);

    return new Response(JSON.stringify({ 
      success: true, 
      giftCard: giftCard 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Complete gift card error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Errore interno del server" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
