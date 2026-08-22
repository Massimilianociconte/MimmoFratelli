/**
 * Authenticated fallback for Checkout success pages.
 *
 * It does not contain a second fulfillment implementation: both this fallback
 * and the Stripe webhook call the same atomic PostgreSQL function.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  extendCheckoutReservationForAsyncPayment,
  finalizeOrderFromStripe,
  getUserEmail,
  loadPendingCheckout,
  recordCheckoutLegalAcceptance,
} from "../_shared/fulfillment.ts";
import {
  getStripe,
  PaymentInputError,
  publicPaymentError,
} from "../_shared/payment.ts";
import { sendOrderConfirmationEmail } from "../_shared/email.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

/**
 * Derives the Stripe mode from the canonical session id prefix so the correct
 * secret key is used even when generic and test keys coexist.
 */
function livemodeFromSessionId(sessionId: string): boolean | undefined {
  if (sessionId.startsWith("cs_live_")) return true;
  if (sessionId.startsWith("cs_test_")) return false;
  return undefined;
}

function response(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request),
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(request) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const userClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") || "",
      {
        global: {
          headers: {
            Authorization: request.headers.get("Authorization") || "",
          },
        },
      },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return response(request, { error: "Devi effettuare il login" }, 401);

    const { sessionId } = await request.json();
    if (
      typeof sessionId !== "string" ||
      !/^cs_(?:test_|live_)?[A-Za-z0-9_]+$/.test(sessionId) ||
      sessionId.length > 256
    ) {
      throw new PaymentInputError("Sessione di pagamento non valida");
    }

    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    );
    const pending = await loadPendingCheckout(supabaseAdmin, sessionId);
    if (pending.checkout_type !== "order" || pending.user_id !== user.id) {
      return response(request, { error: "Sessione non autorizzata" }, 403);
    }

    const session = await getStripe(livemodeFromSessionId(sessionId))
      .checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });
    if (
      session.payment_status !== "paid" &&
      session.payment_status !== "no_payment_required"
    ) {
      await extendCheckoutReservationForAsyncPayment(
        supabaseAdmin,
        session.id,
      );
      return response(request, {
        success: false,
        pending: true,
        message: "Pagamento in elaborazione",
      }, 202);
    }

    // Same compliance ledger as the webhook path: consent is recorded no
    // matter which fulfillment route wins the race.
    await recordCheckoutLegalAcceptance(supabaseAdmin, session);

    const result = await finalizeOrderFromStripe(supabaseAdmin, session);

    const email = await getUserEmail(supabaseAdmin, user.id).catch((error) => {
      console.error(
        "Fallback order email lookup failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      return null;
    });
    if (email) {
      await sendOrderConfirmationEmail(email, result.order).catch((error) => {
        console.error(
          "Fallback order email failed:",
          error instanceof Error ? error.message : "unknown error",
        );
        return false;
      });
    }

    return response(request, {
      success: true,
      order: result.order,
      alreadyExists: !result.created,
    });
  } catch (error) {
    console.error(
      "Complete-order fallback failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    const publicError = publicPaymentError(error);
    return response(request, { error: publicError.message }, publicError.status);
  }
});
