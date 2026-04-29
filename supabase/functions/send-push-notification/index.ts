/**
 * Send Push Notification Edge Function
 * Mimmo Fratelli E-commerce Platform
 * 
 * Simplified version - logs notifications and tracks them in database
 */

// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  'https://www.mimmofratelli.com',
  'https://mimmofratelli.com',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://www.mimmofratelli.com';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error('Missing environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseUser = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
    );

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    const { data: adminRole } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!adminRole) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    
    const { 
      product_id, 
      notification_type = 'seasonal_product',
      custom_title,
      custom_body,
    } = body;

    let notificationTitle = custom_title || 'Mimmo Fratelli';
    let notificationBody = custom_body || 'Hai una nuova notifica!';
    let productName = '';

    if (product_id) {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('id', product_id)
        .single();

      if (productError || !product) {
        throw new Error('Product not found');
      }

      productName = product.name;
      notificationTitle = custom_title || '🍅 Nuovo Prodotto di Stagione!';
      notificationBody = custom_body || `${product.name} è ora disponibile! Fresco e di stagione.`;
    }

    // Get active subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('is_active', true);

    if (subError) {
      throw subError;
    }

    // Get users with seasonal notifications enabled
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id')
      .eq('seasonal_notifications', true);

    const profileIds = profiles || [];
    const enabledUserIds = new Set(profileIds.map((p: { id: string }) => p.id));

    // Count potential recipients
    const allSubscriptions = subscriptions || [];
    let potentialCount = 0;
    
    for (const subscription of allSubscriptions) {
      if (subscription.user_id && !enabledUserIds.has(subscription.user_id)) {
        continue;
      }
      potentialCount++;

      // Log notification
      await supabase.from('notification_logs').insert({
        user_id: subscription.user_id,
        type: notification_type,
        title: notificationTitle,
        body: notificationBody,
        data: { product_id, product_name: productName },
        status: 'pending'
      });
    }

    return new Response(JSON.stringify({
      success: true,
      sent: potentialCount,
      message: `Notifica registrata per ${potentialCount} utenti iscritti.`
    }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});
