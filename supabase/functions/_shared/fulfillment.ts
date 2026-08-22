/**
 * Shared Stripe fulfillment boundary.
 *
 * Stripe proves that money was paid; PostgreSQL owns the trusted checkout
 * snapshot and commits every business side effect in one transaction.
 */

import type Stripe from "npm:stripe@20.4.1";
import {
  assertSettledEuroSession,
  getAsyncReservationMinutes,
} from "./payment.ts";

export interface PendingCheckout {
  id: string;
  stripe_session_id: string;
  stripe_payment_id?: string | null;
  user_id: string;
  checkout_type: "order" | "gift_card";
  status: "created" | "paid" | "completed" | "expired" | "cancelled";
  customer_email?: string | null;
  total: number | string;
}

export interface OrderFulfillmentResult {
  created: boolean;
  order: Record<string, unknown>;
  inventory?: Record<string, unknown>;
  referral?: Record<string, unknown>;
}

export interface GiftCardFulfillmentResult {
  created: boolean;
  giftCard: Record<string, unknown>;
  orderId?: string;
}

export async function loadPendingCheckout(
  supabaseAdmin: any,
  sessionId: string,
): Promise<PendingCheckout> {
  const { data, error } = await supabaseAdmin
    .from("pending_checkout_sessions")
    .select(
      "id, stripe_session_id, stripe_payment_id, user_id, checkout_type, status, customer_email, total",
    )
    .eq("stripe_session_id", sessionId)
    .single();

  if (error || !data) {
    throw new Error(`Trusted checkout snapshot unavailable: ${error?.message || "not found"}`);
  }

  return data as PendingCheckout;
}

function assertSessionOwner(
  session: Stripe.Checkout.Session,
  pending: PendingCheckout,
): void {
  if (
    !pending.user_id ||
    (session.metadata?.userId && session.metadata.userId !== pending.user_id)
  ) {
    throw new Error("Stripe session user does not match checkout snapshot");
  }
}

export async function finalizeOrderFromStripe(
  supabaseAdmin: any,
  session: Stripe.Checkout.Session,
): Promise<OrderFulfillmentResult> {
  const { paymentId, amountTotal } = assertSettledEuroSession(session);
  const pending = await loadPendingCheckout(supabaseAdmin, session.id);

  if (pending.checkout_type !== "order") {
    throw new Error("Checkout type mismatch: expected order");
  }
  assertSessionOwner(session, pending);

  const { data: result, error: finalizeError } = await supabaseAdmin.rpc(
    "finalize_paid_order",
    {
      p_stripe_session_id: session.id,
      p_payment_id: paymentId,
      p_user_id: pending.user_id,
      p_stripe_amount_total: amountTotal,
    },
  );

  if (finalizeError || !result?.success || !result?.order_id) {
    throw new Error(
      `Atomic order fulfillment failed: ${
        finalizeError?.message || result?.reason || "unknown database error"
      }`,
    );
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", result.order_id)
    .single();

  if (orderError || !order) {
    throw new Error(`Finalized order cannot be loaded: ${orderError?.message || "not found"}`);
  }

  return {
    created: result.created === true,
    order,
    inventory: result.inventory,
    referral: result.referral,
  };
}

export async function finalizeGiftCardFromStripe(
  supabaseAdmin: any,
  session: Stripe.Checkout.Session,
): Promise<GiftCardFulfillmentResult> {
  const { paymentId, amountTotal } = assertSettledEuroSession(session);
  const pending = await loadPendingCheckout(supabaseAdmin, session.id);

  if (pending.checkout_type !== "gift_card") {
    throw new Error("Checkout type mismatch: expected gift card");
  }
  assertSessionOwner(session, pending);

  const { data: result, error: finalizeError } = await supabaseAdmin.rpc(
    "finalize_paid_gift_card",
    {
      p_stripe_session_id: session.id,
      p_payment_id: paymentId,
      p_user_id: pending.user_id,
      p_stripe_amount_total: amountTotal,
    },
  );

  if (finalizeError || !result?.success || !result?.gift_card_id) {
    throw new Error(
      `Atomic gift-card fulfillment failed: ${
        finalizeError?.message || result?.reason || "unknown database error"
      }`,
    );
  }

  const { data: giftCard, error: giftError } = await supabaseAdmin
    .from("gift_cards")
    .select("*")
    .eq("id", result.gift_card_id)
    .single();

  if (giftError || !giftCard) {
    throw new Error(`Finalized gift card cannot be loaded: ${giftError?.message || "not found"}`);
  }

  return {
    created: result.created === true,
    giftCard,
    orderId: result.order_id || undefined,
  };
}

export async function releaseCheckoutReservation(
  supabaseAdmin: any,
  sessionId: string,
  reason: string,
): Promise<void> {
  const { error: releaseError } = await supabaseAdmin.rpc(
    "release_checkout_value_reservation_by_session",
    {
      p_stripe_session_id: sessionId,
      p_reason: reason,
    },
  );

  if (releaseError) {
    throw new Error(`Checkout value release failed: ${releaseError.message}`);
  }

  const status = reason === "checkout_session_expired" ? "expired" : "cancelled";
  const { error: pendingError } = await supabaseAdmin
    .from("pending_checkout_sessions")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_session_id", sessionId)
    .neq("status", "completed");

  if (pendingError) {
    throw new Error(`Pending checkout release status failed: ${pendingError.message}`);
  }
}

export async function extendCheckoutReservationForAsyncPayment(
  supabaseAdmin: any,
  sessionId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "extend_checkout_reservation_for_async_payment",
    {
      p_stripe_session_id: sessionId,
      p_hold_minutes: getAsyncReservationMinutes(),
    },
  );

  if (error || !data?.success) {
    throw new Error(
      `Async checkout reservation extension failed: ${
        error?.message || data?.reason || "unknown error"
      }`,
    );
  }
}

export async function getUserEmail(
  supabaseAdmin: any,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) {
    throw new Error(`Auth email lookup failed: ${error.message}`);
  }
  return data?.user?.email || null;
}

/**
 * Persists the ToS/privacy acceptance captured by Stripe Checkout into the
 * compliance ledger. Shared by the webhook, the fallback functions and the
 * reconciler so the consent trail exists on EVERY fulfillment path.
 */
export async function recordCheckoutLegalAcceptance(
  supabaseAdmin: any,
  session: any,
): Promise<void> {
  const termsVersion = session.metadata?.termsVersion;
  const privacyVersion = session.metadata?.privacyVersion;

  // Sessions opened immediately before this release remain fulfillable. Every
  // newly created session carries both version markers and must prove consent.
  if (!termsVersion && !privacyVersion) return;
  if (!termsVersion || !privacyVersion) {
    throw new Error("Checkout legal document versions are incomplete");
  }
  if (session.consent?.terms_of_service !== "accepted") {
    throw new Error("Stripe Checkout terms consent is missing");
  }

  const checkoutType = session.metadata?.type === "gift_card"
    ? "gift_card"
    : "order";
  const userId = session.metadata?.userId || null;

  const { error } = await supabaseAdmin
    .from("checkout_legal_acceptances")
    .upsert({
      stripe_session_id: session.id,
      user_id: userId,
      checkout_type: checkoutType,
      terms_version: termsVersion,
      privacy_version: privacyVersion,
      stripe_terms_status: "accepted",
      checkout_session_created_at: new Date(session.created * 1000).toISOString(),
      recorded_at: new Date().toISOString(),
      livemode: session.livemode,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stripe_session_id" });

  if (error) {
    throw new Error(`Checkout legal acceptance persistence failed: ${error.message}`);
  }
}
