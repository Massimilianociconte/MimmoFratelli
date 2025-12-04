/**
 * Delete Account Edge Function
 * Avenue M. E-commerce Platform
 * 
 * Handles user account deletion with proper cleanup
 */

/// <reference path="../types.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, createResponse, createErrorResponse } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest(req);
  }

  if (req.method !== "POST") {
    return createErrorResponse("Method not allowed", req, 405);
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return createErrorResponse("Missing authorization header", req, 401);
    }

    // Create client with user's token to verify identity
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get the authenticated user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    
    if (userError || !user) {
      return createErrorResponse("Unauthorized", req, 401);
    }

    const userId = user.id;

    // Create admin client for deletion operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Delete user data in order (respecting foreign key constraints)
    // 1. Delete cart items
    await supabaseAdmin.from("cart_items").delete().eq("user_id", userId);
    
    // 2. Delete wishlist items
    await supabaseAdmin.from("wishlist").delete().eq("user_id", userId);
    
    // 3. Delete user presence
    await supabaseAdmin.from("user_presence").delete().eq("user_id", userId);
    
    // 4. Delete user settings
    await supabaseAdmin.from("user_settings").delete().eq("user_id", userId);
    
    // 5. Update orders to anonymize (keep for records but remove user reference)
    await supabaseAdmin.from("orders")
      .update({ 
        user_id: null,
        shipping_address: { deleted: true },
        billing_address: { deleted: true }
      })
      .eq("user_id", userId);
    
    // 6. Delete profile
    await supabaseAdmin.from("profiles").delete().eq("id", userId);
    
    // 7. Delete the auth user
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    
    if (deleteError) {
      console.error("Error deleting user:", deleteError);
      return createErrorResponse("Errore durante l'eliminazione dell'account", req, 500);
    }

    return createResponse({ success: true, message: "Account eliminato con successo" }, req);

  } catch (error) {
    console.error("Delete account error:", error);
    return createErrorResponse("Errore interno del server", req, 500);
  }
});
