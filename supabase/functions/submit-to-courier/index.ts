/**
 * Courier Integration Edge Function
 * Avenue M. E-commerce Platform
 * 
 * Submits orders to courier APIs (BRT, DHL, GLS)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CourierConfig {
  apiUrl: string;
  apiKey: string;
}

const courierConfigs: Record<string, CourierConfig> = {
  brt: {
    apiUrl: Deno.env.get("BRT_API_URL") || "https://api.brt.it/v1",
    apiKey: Deno.env.get("BRT_API_KEY") || "",
  },
  dhl: {
    apiUrl: Deno.env.get("DHL_API_URL") || "https://api.dhl.com/v1",
    apiKey: Deno.env.get("DHL_API_KEY") || "",
  },
  gls: {
    apiUrl: Deno.env.get("GLS_API_URL") || "https://api.gls-italy.com/v1",
    apiKey: Deno.env.get("GLS_API_KEY") || "",
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

    const { orderId, courier = "brt" } = await req.json();

    // Get order details
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = courierConfigs[courier.toLowerCase()];
    if (!config || !config.apiKey) {
      // Flag for manual review if courier not configured
      await supabaseAdmin
        .from("orders")
        .update({ 
          status: "manual_review",
          notes: `Courier ${courier} not configured`
        })
        .eq("id", orderId);

      return new Response(JSON.stringify({ 
        success: false, 
        message: "Courier not configured, flagged for manual review" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prepare shipment data
    const shipmentData = {
      reference: orderId,
      sender: {
        name: "Avenue M.",
        address: "Via Example 123",
        city: "Gallarate",
        postalCode: "21013",
        country: "IT",
      },
      recipient: order.shipping_address,
      parcels: [{
        weight: 1.0, // Default weight
        dimensions: { length: 30, width: 20, height: 10 },
      }],
      service: "standard",
    };

    // Submit to courier API
    try {
      const response = await fetch(`${config.apiUrl}/shipments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(shipmentData),
      });

      if (response.ok) {
        const result = await response.json();
        
        // Update order with tracking info
        await supabaseAdmin
          .from("orders")
          .update({
            status: "shipped",
            tracking_number: result.trackingNumber,
            courier: courier,
          })
          .eq("id", orderId);

        // Log audit entry
        await supabaseAdmin.from("audit_log").insert({
          action: "order_shipped",
          details: { orderId, courier, trackingNumber: result.trackingNumber },
        });

        return new Response(JSON.stringify({ 
          success: true, 
          trackingNumber: result.trackingNumber 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        throw new Error(`Courier API error: ${response.status}`);
      }
    } catch (courierError) {
      // Flag for manual review on courier API failure
      await supabaseAdmin
        .from("orders")
        .update({ 
          status: "manual_review",
          notes: `Courier API error: ${courierError.message}`
        })
        .eq("id", orderId);

      return new Response(JSON.stringify({ 
        success: false, 
        message: "Courier submission failed, flagged for manual review" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("Submit to courier error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
