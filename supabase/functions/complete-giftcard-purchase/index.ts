/**
 * Authenticated fallback for a paid gift-card Checkout Session.
 *
 * The database function creates the order and gift card atomically; this Edge
 * Function only verifies ownership/payment and triggers idempotent delivery.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  finalizeGiftCardFromStripe,
  loadPendingCheckout,
} from "../_shared/fulfillment.ts";
import {
  getStripe,
  PaymentInputError,
  publicPaymentError,
} from "../_shared/payment.ts";
import { sendGiftCardEmailTo } from "../_shared/email.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

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
    if (pending.checkout_type !== "gift_card" || pending.user_id !== user.id) {
      return response(request, { error: "Sessione non autorizzata" }, 403);
    }

    const session = await getStripe().checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });
    if (
      session.payment_status !== "paid" &&
      session.payment_status !== "no_payment_required"
    ) {
      return response(request, {
        success: false,
        pending: true,
        message: "Pagamento in elaborazione",
      }, 202);
    }

    const result = await finalizeGiftCardFromStripe(supabaseAdmin, session);

    await sendGiftCardEmailTo(result.giftCard as any).catch((error) => {
      console.error(
        "Fallback gift-card delivery failed:",
        error instanceof Error ? error.message : "unknown error",
      );
      return false;
    });

    return response(request, {
      success: true,
      giftCard: result.giftCard,
      alreadyCreated: !result.created,
    });
  } catch (error) {
    console.error(
      "Complete gift-card fallback failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    const publicError = publicPaymentError(error);
    return response(request, { error: publicError.message }, publicError.status);
  }
});
