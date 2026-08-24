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

    // Helper: run a cleanup step and abort before deleting the auth user if
    // it fails. Returning success while leaving PII behind would be a GDPR
    // violation, so every step's error is checked.
    const runStep = async (label: string, operation: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await operation;
      if (error) {
        console.error(`Delete account step failed (${label}):`, error);
        throw new Error(`${label}: ${error.message}`);
      }
    };

    try {
      // Delete user data in order (respecting foreign key constraints)
      // 1. Delete cart items
      await runStep("cart_items", supabaseAdmin.from("cart_items").delete().eq("user_id", userId));

      // 2. Delete wishlist items
      await runStep("wishlist_items", supabaseAdmin.from("wishlist_items").delete().eq("user_id", userId));

      // 3. Delete user presence
      await runStep("user_presence", supabaseAdmin.from("user_presence").delete().eq("user_id", userId));

      // 4. Delete user settings
      await runStep("user_settings", supabaseAdmin.from("user_settings").delete().eq("user_id", userId));

      // 5. Delete stock alerts
      await runStep("stock_alerts", supabaseAdmin.from("stock_alerts").delete().eq("user_id", userId));

      // 6. Delete push notification subscriptions
      await runStep("push_subscriptions", supabaseAdmin.from("push_subscriptions").delete().eq("user_id", userId));

      // 7. Delete referral relationships (as referrer and referee)
      await runStep("referrals (referrer)", supabaseAdmin.from("referrals").delete().eq("referrer_id", userId));
      await runStep("referrals (referee)", supabaseAdmin.from("referrals").delete().eq("referee_id", userId));

      // 8. Delete user referral codes
      await runStep("user_referral_codes", supabaseAdmin.from("user_referral_codes").delete().eq("user_id", userId));

      // 9. Delete credit transactions
      await runStep("credit_transactions", supabaseAdmin.from("credit_transactions").delete().eq("user_id", userId));

      // 10. Delete user credits
      await runStep("user_credits", supabaseAdmin.from("user_credits").delete().eq("user_id", userId));

      // 11. Deactivate user-specific promotions (first-order codes)
      await runStep("promotions", supabaseAdmin.from("promotions")
        .update({ is_active: false })
        .eq("user_id", userId));

      // 12. Update orders to anonymize (keep for records but remove user reference)
      await runStep("orders anonymization", supabaseAdmin.from("orders")
        .update({
          user_id: null,
          shipping_address: { deleted: true },
          billing_address: { deleted: true }
        })
        .eq("user_id", userId));

      // 13. Delete profile
      await runStep("profiles", supabaseAdmin.from("profiles").delete().eq("id", userId));
    } catch (cleanupError) {
      // Do NOT delete the auth user: the account stays usable and retryable
      console.error("Aborting account deletion, cleanup failed:", cleanupError);
      return createErrorResponse("Errore durante la pulizia dei dati. Riprova più tardi.", req, 500);
    }

    // 14. Delete the auth user
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
