/**
 * Handle Signup Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Triggered after user registration to:
 * 1. Generate first-order discount code (BENVENUTO)
 * 2. Generate permanent referral code
 * 3. Process referral relationship if applicable
 * 
 * Requirements: 1.1, 1.2, 2.1, 3.2, 3.3, 3.4, 5.1
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Valid characters for code generation (no confusing chars)
const VALID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface SignupRequest {
  userId: string;
  email: string;
  referralCode?: string;
  ipAddress?: string;
}

interface SystemConfig {
  first_order_discount: { percentage: number; validity_days: number };
  referral_first_order_discount: { percentage: number; validity_days: number };
  referral_reward: { amount: number; currency: string };
}

/**
 * Generate random code from valid characters
 */
function generateCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += VALID_CHARS.charAt(Math.floor(Math.random() * VALID_CHARS.length));
  }
  return code;
}

/**
 * Generate first-order promo code (BENVENUTO + 6 chars)
 */
function generateFirstOrderCode(): string {
  return 'BENVENUTO' + generateCode(6);
}

/**
 * Generate 8-character referral code
 */
function generateReferralCode(): string {
  return generateCode(8);
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { userId, email, referralCode, ipAddress }: SignupRequest = await req.json();

    if (!userId || !email) {
      return new Response(JSON.stringify({ error: "userId and email required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing signup for user ${userId} (${email})`);

    // Get system configuration
    const { data: configData } = await supabaseAdmin
      .from('system_config')
      .select('key, value')
      .in('key', ['first_order_discount', 'referral_first_order_discount', 'referral_reward']);

    const config: Partial<SystemConfig> = {};
    (configData || []).forEach(c => {
      config[c.key as keyof SystemConfig] = c.value;
    });

    // Default values if config not found
    const standardDiscount = config.first_order_discount?.percentage ?? 10;
    const referralDiscount = config.referral_first_order_discount?.percentage ?? 15;
    const validityDays = config.first_order_discount?.validity_days ?? 30;
    const rewardAmount = config.referral_reward?.amount ?? 5;

    // Check if referral code is valid and not self-referral
    let referrerId: string | null = null;
    let isValidReferral = false;

    if (referralCode) {
      const { data: referrerData } = await supabaseAdmin
        .from('user_referral_codes')
        .select('user_id')
        .eq('code', referralCode.toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (referrerData && referrerData.user_id !== userId) {
        // Check if referrer email is different (additional self-referral check)
        const { data: referrerProfile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', referrerData.user_id)
          .maybeSingle();

        // Also check auth.users for email match
        const { data: referrerAuth } = await supabaseAdmin.auth.admin.getUserById(referrerData.user_id);
        
        if (referrerAuth?.user?.email?.toLowerCase() !== email.toLowerCase()) {
          referrerId = referrerData.user_id;
          isValidReferral = true;
          console.log(`Valid referral from ${referrerId}`);
        } else {
          console.log('Self-referral detected by email match, ignoring referral');
        }
      } else if (referrerData?.user_id === userId) {
        console.log('Self-referral detected by user_id match, ignoring referral');
      } else {
        console.log(`Invalid referral code: ${referralCode}`);
      }
    }

    // Determine discount percentage
    const discountPercent = isValidReferral ? referralDiscount : standardDiscount;

    // Generate unique first-order promo code
    let promoCode = generateFirstOrderCode();
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await supabaseAdmin
        .from('promotions')
        .select('code')
        .eq('code', promoCode)
        .maybeSingle();
      
      if (!existing) break;
      promoCode = generateFirstOrderCode();
      attempts++;
    }

    // Calculate validity dates
    const startsAt = new Date();
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + validityDays);

    // Create first-order promotion
    const { data: promotion, error: promoError } = await supabaseAdmin
      .from('promotions')
      .insert({
        name: isValidReferral ? 'Sconto Primo Ordine (Referral)' : 'Sconto Primo Ordine',
        description: `${discountPercent}% di sconto sul tuo primo ordine`,
        code: promoCode,
        discount_type: 'percentage',
        discount_value: discountPercent,
        min_purchase: 0,
        max_discount: null,
        usage_limit: 1,
        usage_count: 0,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        is_active: true,
        user_id: userId,
        is_first_order_code: true,
        referral_bonus: isValidReferral
      })
      .select()
      .single();

    if (promoError) {
      console.error('Error creating promotion:', promoError);
      throw promoError;
    }

    console.log(`Created first-order code ${promoCode} with ${discountPercent}% discount`);

    // Generate unique referral code for the new user
    let userReferralCode = generateReferralCode();
    attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await supabaseAdmin
        .from('user_referral_codes')
        .select('code')
        .eq('code', userReferralCode)
        .maybeSingle();
      
      if (!existing) break;
      userReferralCode = generateReferralCode();
      attempts++;
    }

    // Create user's referral code
    const { error: refCodeError } = await supabaseAdmin
      .from('user_referral_codes')
      .insert({
        user_id: userId,
        code: userReferralCode,
        is_active: true,
        total_referrals: 0,
        total_conversions: 0,
        total_earned: 0
      });

    if (refCodeError) {
      console.error('Error creating referral code:', refCodeError);
      // Don't throw - this is not critical
    } else {
      console.log(`Created referral code ${userReferralCode} for user`);
    }

    // Create referral relationship if valid
    if (isValidReferral && referrerId) {
      const { error: refError } = await supabaseAdmin
        .from('referrals')
        .insert({
          referrer_id: referrerId,
          referee_id: userId,
          referral_code: referralCode!.toUpperCase(),
          status: 'pending',
          reward_amount: rewardAmount,
          reward_credited: false,
          ip_address: ipAddress || null
        });

      if (refError) {
        console.error('Error creating referral relationship:', refError);
        // Don't throw - user is still created
      } else {
        // Increment referrer's total_referrals count
        await supabaseAdmin
          .from('user_referral_codes')
          .update({ total_referrals: supabaseAdmin.rpc('increment_referral_count', { p_user_id: referrerId }) })
          .eq('user_id', referrerId);

        // Simple increment without RPC
        const { data: currentStats } = await supabaseAdmin
          .from('user_referral_codes')
          .select('total_referrals')
          .eq('user_id', referrerId)
          .single();

        if (currentStats) {
          await supabaseAdmin
            .from('user_referral_codes')
            .update({ total_referrals: (currentStats.total_referrals || 0) + 1 })
            .eq('user_id', referrerId);
        }

        console.log(`Created referral relationship: ${referrerId} -> ${userId}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      firstOrderCode: promoCode,
      discountPercent,
      referralCode: userReferralCode,
      isReferral: isValidReferral,
      referrerId: isValidReferral ? referrerId : null
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Handle signup error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Internal server error"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
