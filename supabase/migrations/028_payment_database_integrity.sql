-- Mimmo Fratelli E-commerce Platform
-- Migration 028: payment/database integrity and least-privilege hardening
--
-- Goals:
--   * reserve credits, gift-card balances and limited promotions before Checkout;
--   * finalize each paid order atomically (order, lines, inventory and side effects);
--   * make Stripe webhook claiming lease-based and concurrency safe;
--   * repair/refine referral conversion and refund handling;
--   * remove public execution from privileged SECURITY DEFINER functions;
--   * tighten payment-related RLS policies and remove exact duplicate indexes.
--
-- This migration intentionally does not change Stripe dashboard configuration.

-- ============================================================
-- BASE INTEGRITY CONSTRAINTS
-- NOT VALID protects existing historical rows while enforcing all
-- new/updated rows. A later maintenance migration can VALIDATE them
-- after any legacy data has been reconciled.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_credits'::regclass
      AND conname = 'user_credits_totals_nonnegative'
  ) THEN
    ALTER TABLE public.user_credits
      ADD CONSTRAINT user_credits_totals_nonnegative
      CHECK (total_earned >= 0 AND total_spent >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.gift_cards'::regclass
      AND conname = 'gift_cards_remaining_balance_range'
  ) THEN
    ALTER TABLE public.gift_cards
      ADD CONSTRAINT gift_cards_remaining_balance_range
      CHECK (
        remaining_balance >= 0
        AND remaining_balance <= amount
        AND balance >= 0
        AND balance <= amount
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.promotions'::regclass
      AND conname = 'promotions_value_range'
  ) THEN
    ALTER TABLE public.promotions
      ADD CONSTRAINT promotions_value_range
      CHECK (
        discount_value > 0
        AND (discount_type <> 'percentage' OR discount_value <= 100)
        AND (max_discount IS NULL OR max_discount > 0)
        AND (usage_limit IS NULL OR usage_limit > 0)
        AND usage_count >= 0
        AND (usage_limit IS NULL OR usage_count <= usage_limit)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.referrals'::regclass
      AND conname = 'referrals_reward_positive'
  ) THEN
    ALTER TABLE public.referrals
      ADD CONSTRAINT referrals_reward_positive
      CHECK (reward_amount > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pending_checkout_sessions'::regclass
      AND conname = 'pending_checkout_amounts_reconcile'
  ) THEN
    ALTER TABLE public.pending_checkout_sessions
      ADD CONSTRAINT pending_checkout_amounts_reconcile
      CHECK (
        ABS(
          total - (
            subtotal + shipping_cost
            - discount_amount
            - gift_card_amount
            - user_credit_amount
          )
        ) <= 0.01
      ) NOT VALID;
  END IF;
END $$;

-- Exact duplicates observed in the linked database. Their equivalent UNIQUE
-- indexes/constraints remain in place.
DROP INDEX IF EXISTS public.idx_referrals_referee;
DROP INDEX IF EXISTS public.idx_referral_codes_code;
DROP INDEX IF EXISTS public.idx_orders_payment_id;
DROP INDEX IF EXISTS public.idx_fcm_tokens_user_id;

-- A UNIQUE btree serves the same equality/range lookups as an equivalent
-- non-unique btree. Retain the constraints and remove their redundant
-- write-amplification/storage cost.
DROP INDEX IF EXISTS public.idx_categories_slug;
DROP INDEX IF EXISTS public.idx_gift_cards_qr_token;
DROP INDEX IF EXISTS public.idx_gift_cards_code;
DROP INDEX IF EXISTS public.idx_orders_number;
DROP INDEX IF EXISTS public.idx_products_slug;
DROP INDEX IF EXISTS public.idx_used_codes_code;
DROP INDEX IF EXISTS public.idx_used_codes_qr_token;
DROP INDEX IF EXISTS public.idx_user_credits_user;
DROP INDEX IF EXISTS public.idx_user_presence_session;

-- Supporting indexes keep FK checks and parent-row deletes from scanning the
-- referencing tables. They also cover the ownership/refund lookups used by
-- RLS and payment compensation paths.
CREATE INDEX IF NOT EXISTS idx_user_presence_user_id
  ON public.user_presence(user_id);
CREATE INDEX IF NOT EXISTS idx_system_config_updated_by
  ON public.system_config(updated_by)
  WHERE updated_by IS NOT NULL;

-- A legacy four-column constraint can reappear on databases initially created
-- from migration 002. It prevents distinct weight variants in the cart.
ALTER TABLE public.cart_items
  DROP CONSTRAINT IF EXISTS cart_items_user_id_product_id_size_color_key;

CREATE INDEX IF NOT EXISTS idx_referrals_converted_order
  ON public.referrals(converted_order_id)
  WHERE converted_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gift_cards_purchased_order
  ON public.gift_cards(purchased_order_id)
  WHERE purchased_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gift_cards_code_normalized
  ON public.gift_cards((REPLACE(UPPER(code), '-', '')));

-- ============================================================
-- ADMIN HELPER AND PAYMENT-RELATED RLS
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Anyone can view active promotions" ON public.promotions;
DROP POLICY IF EXISTS "Admins can view all promotions" ON public.promotions;
DROP POLICY IF EXISTS "Admins can manage promotions" ON public.promotions;
DROP POLICY IF EXISTS "Public can view regular active promotions" ON public.promotions;
DROP POLICY IF EXISTS "Users can view own first-order promotion" ON public.promotions;
DROP POLICY IF EXISTS "Admins can manage promotions v2" ON public.promotions;

CREATE POLICY "Public can view regular active promotions"
  ON public.promotions
  FOR SELECT
  TO anon, authenticated
  USING (
    is_active
    AND NOW() BETWEEN starts_at AND ends_at
    AND (
      NOT COALESCE(is_first_order_code, false)
      OR user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Admins can manage promotions v2"
  ON public.promotions
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Users can read own referral code" ON public.user_referral_codes;
DROP POLICY IF EXISTS "Users can read any active referral code" ON public.user_referral_codes;
DROP POLICY IF EXISTS "Users can read own referral code v2" ON public.user_referral_codes;

CREATE POLICY "Users can read own referral code v2"
  ON public.user_referral_codes
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can read own referrals" ON public.referrals;
DROP POLICY IF EXISTS "Users can read own referrals v2" ON public.referrals;

CREATE POLICY "Users can read own referrals v2"
  ON public.referrals
  FOR SELECT
  TO authenticated
  USING (
    referrer_id = (SELECT auth.uid())
    OR referee_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can update orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view own orders v2" ON public.orders;
DROP POLICY IF EXISTS "Admins can view all orders v2" ON public.orders;
DROP POLICY IF EXISTS "Admins can update orders v2" ON public.orders;

CREATE POLICY "Users can view own orders v2"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can view all orders v2"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

CREATE POLICY "Admins can update orders v2"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Users can view own order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can view all order items" ON public.order_items;
DROP POLICY IF EXISTS "Users can view own order items v2" ON public.order_items;
DROP POLICY IF EXISTS "Admins can view all order items v2" ON public.order_items;

CREATE POLICY "Users can view own order items v2"
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders
      WHERE orders.id = order_items.order_id
        AND orders.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Admins can view all order items v2"
  ON public.order_items
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Users can view own gift cards" ON public.gift_cards;
DROP POLICY IF EXISTS "Admins can manage gift cards" ON public.gift_cards;
DROP POLICY IF EXISTS "Users can view own gift cards v2" ON public.gift_cards;
DROP POLICY IF EXISTS "Admins can manage gift cards v2" ON public.gift_cards;

CREATE POLICY "Users can view own gift cards v2"
  ON public.gift_cards
  FOR SELECT
  TO authenticated
  USING (
    purchased_by = (SELECT auth.uid())
    OR redeemed_by = (SELECT auth.uid())
  );

CREATE POLICY "Admins can manage gift cards v2"
  ON public.gift_cards
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Users can view own credits" ON public.user_credits;
DROP POLICY IF EXISTS "Admins can view all credits" ON public.user_credits;
DROP POLICY IF EXISTS "Users can view own credits v2" ON public.user_credits;
DROP POLICY IF EXISTS "Admins can manage all credits v2" ON public.user_credits;

CREATE POLICY "Users can view own credits v2"
  ON public.user_credits
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can manage all credits v2"
  ON public.user_credits
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Users can view own transactions" ON public.credit_transactions;
DROP POLICY IF EXISTS "Admins can view all transactions" ON public.credit_transactions;
DROP POLICY IF EXISTS "Users can view own transactions v2" ON public.credit_transactions;
DROP POLICY IF EXISTS "Admins can manage all transactions v2" ON public.credit_transactions;

CREATE POLICY "Users can view own transactions v2"
  ON public.credit_transactions
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can manage all transactions v2"
  ON public.credit_transactions
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Users can view own pending checkout sessions"
  ON public.pending_checkout_sessions;
DROP POLICY IF EXISTS "Admins can view pending checkout sessions"
  ON public.pending_checkout_sessions;
DROP POLICY IF EXISTS "Users can view own pending checkout sessions v2"
  ON public.pending_checkout_sessions;
DROP POLICY IF EXISTS "Admins can view pending checkout sessions v2"
  ON public.pending_checkout_sessions;

CREATE POLICY "Users can view own pending checkout sessions v2"
  ON public.pending_checkout_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can view pending checkout sessions v2"
  ON public.pending_checkout_sessions
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Users can view own stock alerts" ON public.stock_alerts;
DROP POLICY IF EXISTS "Users can create stock alerts" ON public.stock_alerts;
DROP POLICY IF EXISTS "Users can delete own stock alerts" ON public.stock_alerts;
DROP POLICY IF EXISTS "Users can update own stock alerts" ON public.stock_alerts;
DROP POLICY IF EXISTS "Users can manage own stock alerts v2" ON public.stock_alerts;
DROP POLICY IF EXISTS "Admins can manage stock alerts v2" ON public.stock_alerts;

CREATE POLICY "Users can manage own stock alerts v2"
  ON public.stock_alerts
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND email IS NULL
  );

CREATE POLICY "Admins can manage stock alerts v2"
  ON public.stock_alerts
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

REVOKE ALL ON public.stock_alerts FROM anon;

-- Service-role requests bypass RLS; a WITH CHECK (true) policy granted to every
-- client role only creates forged audit/notification records.
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_log;
DROP POLICY IF EXISTS "Service role can insert notification logs"
  ON public.notification_logs;

-- ============================================================
-- LEGACY SECURITY DEFINER SURFACES
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_gift_card_code_available(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    char_length(TRIM(COALESCE(p_code, ''))) BETWEEN 10 AND 64
    AND NOT EXISTS (
      SELECT 1
      FROM public.used_gift_card_codes
      WHERE REPLACE(UPPER(code), '-', '') =
        REPLACE(UPPER(TRIM(p_code)), '-', '')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.gift_cards
      WHERE REPLACE(UPPER(code), '-', '') =
        REPLACE(UPPER(TRIM(p_code)), '-', '')
    );
$$;

REVOKE ALL ON FUNCTION public.is_gift_card_code_available(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_gift_card_code_available(TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.sync_profile_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    phone,
    address,
    city,
    zip,
    province,
    newsletter,
    order_notifications
  )
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data->>'first_name')::TEXT, ''),
    COALESCE((NEW.raw_user_meta_data->>'last_name')::TEXT, ''),
    (NEW.raw_user_meta_data->>'phone')::TEXT,
    (NEW.raw_user_meta_data->>'address')::TEXT,
    (NEW.raw_user_meta_data->>'city')::TEXT,
    (NEW.raw_user_meta_data->>'zip')::TEXT,
    (NEW.raw_user_meta_data->>'province')::TEXT,
    COALESCE((NEW.raw_user_meta_data->>'newsletter')::BOOLEAN, true),
    COALESCE((NEW.raw_user_meta_data->>'order_notifications')::BOOLEAN, true)
  )
  ON CONFLICT (id) DO UPDATE
  SET
    first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.profiles.last_name),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    address = COALESCE(EXCLUDED.address, public.profiles.address),
    city = COALESCE(EXCLUDED.city, public.profiles.city),
    zip = COALESCE(EXCLUDED.zip, public.profiles.zip),
    province = COALESCE(EXCLUDED.province, public.profiles.province),
    newsletter = COALESCE(EXCLUDED.newsletter, public.profiles.newsletter),
    order_notifications = COALESCE(
      EXCLUDED.order_notifications,
      public.profiles.order_notifications
    ),
    updated_at = NOW();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_from_auth()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_stock_alert(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.stock_alerts
    WHERE product_id = p_product_id
      AND user_id = (SELECT auth.uid())
      AND is_active
  );
$$;

REVOKE ALL ON FUNCTION public.has_stock_alert(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_stock_alert(UUID)
  TO authenticated, service_role;

ALTER FUNCTION public.handle_new_user() SET search_path = '';
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================
-- MINIMAL PUBLIC VALIDATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_referral_code(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_referral_codes
    WHERE code = UPPER(TRIM(COALESCE(p_code, '')))
      AND is_active
  );
$$;

REVOKE ALL ON FUNCTION public.validate_referral_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_referral_code(TEXT)
  TO anon, authenticated, service_role;

-- Codes are bearer credentials. New codes use 80 random UUID bits instead of
-- PostgreSQL random(), and remain compatible with the existing UI.
CREATE OR REPLACE FUNCTION public.generate_gift_card_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code TEXT;
  v_attempt INTEGER := 0;
BEGIN
  LOOP
    v_code := UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 20));
    v_attempt := v_attempt + 1;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.gift_cards
      WHERE REPLACE(UPPER(code), '-', '') = v_code
    ) AND NOT EXISTS (
      SELECT 1 FROM public.used_gift_card_codes
      WHERE REPLACE(UPPER(code), '-', '') = v_code
    );

    IF v_attempt >= 20 THEN
      RAISE EXCEPTION 'Unable to generate a unique gift-card code';
    END IF;
  END LOOP;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_gift_card_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_gift_card_code() TO service_role;

-- ============================================================
-- CHECKOUT VALUE RESERVATIONS
-- The visible balance is reduced before Stripe Checkout is opened. The
-- reservation is consumed on payment or restored on expiry/failure.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.checkout_value_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_key TEXT UNIQUE NOT NULL,
  stripe_session_id TEXT UNIQUE,
  order_id UUID UNIQUE REFERENCES public.orders(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 100),
  credit_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  credit_balance_before NUMERIC(10,2),
  credit_balance_after NUMERIC(10,2),
  gift_card_id UUID REFERENCES public.gift_cards(id) ON DELETE SET NULL,
  gift_card_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (gift_card_amount >= 0),
  promotion_id UUID REFERENCES public.promotions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'consumed', 'released', 'refunded')),
  expires_at TIMESTAMPTZ NOT NULL,
  release_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  CHECK (char_length(reservation_key) BETWEEN 16 AND 128)
);

CREATE INDEX IF NOT EXISTS idx_checkout_value_reservations_user
  ON public.checkout_value_reservations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkout_value_reservations_expiry
  ON public.checkout_value_reservations(status, expires_at)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_checkout_value_reservations_promotion
  ON public.checkout_value_reservations(promotion_id, status, expires_at)
  WHERE promotion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkout_reservations_gift_card
  ON public.checkout_value_reservations(gift_card_id)
  WHERE gift_card_id IS NOT NULL;

ALTER TABLE public.checkout_value_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own checkout reservations"
  ON public.checkout_value_reservations;
DROP POLICY IF EXISTS "Admins can view checkout reservations"
  ON public.checkout_value_reservations;

CREATE POLICY "Users can view own checkout reservations"
  ON public.checkout_value_reservations
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Admins can view checkout reservations"
  ON public.checkout_value_reservations
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

-- Replace the loop-based legacy generators that trigger PL/pgSQL shadowed
-- variable warnings. UUID randomness is sufficient for non-secret referral and
-- first-order display codes; uniqueness remains enforced by table constraints.
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS VARCHAR(8)
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT UPPER(
    SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 8)
  )::VARCHAR(8);
$$;

CREATE OR REPLACE FUNCTION public.generate_first_order_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT 'BENVENUTO' || UPPER(
    SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 6)
  );
$$;

-- Migration 008 added an unused overload that targets a non-existent
-- audit_log.details column. Keep the original six-argument audit function and
-- remove the broken SECURITY DEFINER surface.
DROP FUNCTION IF EXISTS public.create_audit_log(UUID, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.release_checkout_value_reservation(
  p_reservation_id UUID,
  p_reason TEXT DEFAULT 'released'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_res public.checkout_value_reservations%ROWTYPE;
BEGIN
  SELECT *
  INTO v_res
  FROM public.checkout_value_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'reservation_not_found');
  END IF;

  IF v_res.status <> 'reserved' THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'status', v_res.status);
  END IF;

  -- Lock order is consistent with reserve_checkout_value: promotion, gift card,
  -- then user credits. The reservation row itself serializes release/consume.
  IF v_res.promotion_id IS NOT NULL THEN
    PERFORM id
    FROM public.promotions
    WHERE id = v_res.promotion_id
    FOR UPDATE;
  END IF;

  IF v_res.gift_card_id IS NOT NULL AND v_res.gift_card_amount > 0 THEN
    PERFORM id
    FROM public.gift_cards
    WHERE id = v_res.gift_card_id
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.gift_cards
      SET
        balance = LEAST(amount, COALESCE(balance, 0) + v_res.gift_card_amount),
        remaining_balance = LEAST(
          amount,
          COALESCE(remaining_balance, balance, 0) + v_res.gift_card_amount
        ),
        is_active = (
          expires_at IS NULL
          OR expires_at > NOW()
        )
      WHERE id = v_res.gift_card_id;
    END IF;
  END IF;

  IF v_res.credit_amount > 0 THEN
    PERFORM id
    FROM public.user_credits
    WHERE user_id = v_res.user_id
    FOR UPDATE;

    UPDATE public.user_credits
    SET
      balance = balance + v_res.credit_amount,
      updated_at = NOW()
    WHERE user_id = v_res.user_id;
  END IF;

  UPDATE public.checkout_value_reservations
  SET
    status = 'released',
    release_reason = LEFT(COALESCE(NULLIF(TRIM(p_reason), ''), 'released'), 200),
    released_at = NOW(),
    updated_at = NOW()
  WHERE id = v_res.id;

  RETURN jsonb_build_object('success', true, 'status', 'released');
END;
$$;

CREATE OR REPLACE FUNCTION public.release_checkout_value_reservation_by_session(
  p_stripe_session_id TEXT,
  p_reason TEXT DEFAULT 'released'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id
  INTO v_id
  FROM public.checkout_value_reservations
  WHERE stripe_session_id = NULLIF(TRIM(p_stripe_session_id), '')
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  RETURN public.release_checkout_value_reservation(v_id, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_checkout_value(
  p_user_id UUID,
  p_reservation_key TEXT,
  p_credit_amount NUMERIC,
  p_gift_card_code TEXT DEFAULT NULL,
  p_gift_card_amount NUMERIC DEFAULT 0,
  p_promotion_code TEXT DEFAULT NULL,
  p_subtotal NUMERIC DEFAULT 0,
  p_items JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing public.checkout_value_reservations%ROWTYPE;
  v_promo public.promotions%ROWTYPE;
  v_gc public.gift_cards%ROWTYPE;
  v_credit public.user_credits%ROWTYPE;
  v_credit_amount NUMERIC(10,2) := ROUND(COALESCE(p_credit_amount, 0), 2);
  v_gift_amount NUMERIC(10,2) := ROUND(COALESCE(p_gift_card_amount, 0), 2);
  v_subtotal NUMERIC(10,2) := ROUND(COALESCE(p_subtotal, 0), 2);
  v_gc_available NUMERIC(10,2);
  v_active_promo_reservations INTEGER := 0;
  v_item RECORD;
  v_inventory_available INTEGER;
  v_inventory_reserved INTEGER;
  v_id UUID;
BEGIN
  IF p_user_id IS NULL
    OR p_reservation_key IS NULL
    OR char_length(TRIM(p_reservation_key)) NOT BETWEEN 16 AND 128
    OR v_credit_amount < 0
    OR v_gift_amount < 0
    OR v_subtotal < 0
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100
    OR v_credit_amount <> COALESCE(p_credit_amount, 0)
    OR v_gift_amount <> COALESCE(p_gift_card_amount, 0)
  THEN
    RAISE EXCEPTION 'Invalid checkout reservation input'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.checkout_value_reservations
  WHERE reservation_key = TRIM(p_reservation_key)
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Reservation key belongs to another user'
        USING ERRCODE = '42501';
    END IF;

    IF v_existing.status = 'reserved' AND v_existing.expires_at > NOW() THEN
      IF v_existing.credit_amount <> v_credit_amount
        OR v_existing.gift_card_amount <> v_gift_amount
        OR v_existing.items <> p_items
      THEN
        RAISE EXCEPTION 'Idempotency key reused with different amounts'
          USING ERRCODE = '22023';
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'reservation_id', v_existing.id,
        'expires_at', v_existing.expires_at,
        'reused', true
      );
    END IF;

    IF v_existing.status = 'reserved' THEN
      PERFORM public.release_checkout_value_reservation(
        v_existing.id,
        'reservation_expired_before_retry'
      );
      SELECT *
      INTO v_existing
      FROM public.checkout_value_reservations
      WHERE id = v_existing.id
      FOR UPDATE;
    ELSIF v_existing.status IN ('consumed', 'refunded') THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'reservation_already_finalized',
        'status', v_existing.status
      );
    END IF;
  END IF;

  -- Inventory rows are locked in a deterministic product/weight order. Active
  -- reservations are subtracted without mutating stock, so expired sessions
  -- need no inventory compensation.
  FOR v_item IN
    SELECT
      item.product_id,
      item.weight_grams,
      SUM(item.quantity)::INTEGER AS quantity
    FROM jsonb_to_recordset(p_items) AS item(
      product_id UUID,
      quantity INTEGER,
      weight_grams INTEGER
    )
    GROUP BY item.product_id, item.weight_grams
    ORDER BY item.product_id, item.weight_grams NULLS FIRST
  LOOP
    IF v_item.product_id IS NULL
      OR v_item.quantity NOT BETWEEN 1 AND 100
    THEN
      RAISE EXCEPTION 'Invalid inventory reservation item'
        USING ERRCODE = '22023';
    END IF;

    PERFORM id
    FROM public.products
    WHERE id = v_item.product_id
      AND is_active
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product is no longer available'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_item.weight_grams IS NOT NULL THEN
      SELECT quantity
      INTO v_inventory_available
      FROM public.weight_inventory
      WHERE product_id = v_item.product_id
        AND weight_grams = v_item.weight_grams
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Weight variant is no longer available'
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      SELECT num_items
      INTO v_inventory_available
      FROM public.products
      WHERE id = v_item.product_id
      FOR UPDATE;

      -- NULL means this product is not tracked by piece count.
      IF v_inventory_available IS NULL THEN
        CONTINUE;
      END IF;
    END IF;

    SELECT COALESCE(SUM(reserved_item.quantity), 0)::INTEGER
    INTO v_inventory_reserved
    FROM public.checkout_value_reservations AS reservation
    CROSS JOIN LATERAL jsonb_to_recordset(reservation.items) AS reserved_item(
      product_id UUID,
      quantity INTEGER,
      weight_grams INTEGER
    )
    WHERE reservation.status = 'reserved'
      AND reservation.expires_at > NOW()
      AND (v_existing.id IS NULL OR reservation.id <> v_existing.id)
      AND reserved_item.product_id = v_item.product_id
      AND reserved_item.weight_grams IS NOT DISTINCT FROM v_item.weight_grams;

    IF v_inventory_available - v_inventory_reserved < v_item.quantity THEN
      RAISE EXCEPTION 'Insufficient unreserved inventory'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Remaining lock order is promotion -> gift card -> user credits.
  IF NULLIF(TRIM(COALESCE(p_promotion_code, '')), '') IS NOT NULL THEN
    SELECT *
    INTO v_promo
    FROM public.promotions
    WHERE code = UPPER(TRIM(p_promotion_code))
    FOR UPDATE;

    IF NOT FOUND
      OR NOT v_promo.is_active
      OR NOW() NOT BETWEEN v_promo.starts_at AND v_promo.ends_at
      OR v_subtotal < COALESCE(v_promo.min_purchase, 0)
      OR (
        COALESCE(v_promo.is_first_order_code, false)
        AND v_promo.user_id IS DISTINCT FROM p_user_id
      )
      OR (
        COALESCE(v_promo.is_first_order_code, false)
        AND EXISTS (
          SELECT 1
          FROM public.orders
          WHERE user_id = p_user_id
            AND payment_status = 'completed'
        )
      )
    THEN
      RAISE EXCEPTION 'Promotion is no longer available'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_active_promo_reservations
    FROM public.checkout_value_reservations
    WHERE promotion_id = v_promo.id
      AND status = 'reserved'
      AND expires_at > NOW()
      AND (v_existing.id IS NULL OR id <> v_existing.id);

    IF v_promo.usage_limit IS NOT NULL
      AND COALESCE(v_promo.usage_count, 0) + v_active_promo_reservations
        >= v_promo.usage_limit
    THEN
      RAISE EXCEPTION 'Promotion usage limit reached'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_gift_amount > 0 THEN
    IF NULLIF(TRIM(COALESCE(p_gift_card_code, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Gift-card code required'
        USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_gc
    FROM public.gift_cards
    WHERE REPLACE(UPPER(code), '-', '') =
      REPLACE(UPPER(TRIM(p_gift_card_code)), '-', '')
    FOR UPDATE;

    IF NOT FOUND
      OR NOT v_gc.is_active
      OR COALESCE(v_gc.is_redeemed, false)
      OR (v_gc.expires_at IS NOT NULL AND v_gc.expires_at <= NOW())
    THEN
      RAISE EXCEPTION 'Gift card is no longer available'
        USING ERRCODE = 'P0001';
    END IF;

    v_gc_available := GREATEST(
      0,
      LEAST(
        COALESCE(v_gc.remaining_balance, v_gc.balance, v_gc.amount),
        COALESCE(v_gc.balance, v_gc.amount),
        v_gc.amount
      )
    );

    IF v_gc_available < v_gift_amount THEN
      RAISE EXCEPTION 'Insufficient gift-card balance'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_credit_amount > 0 THEN
    SELECT *
    INTO v_credit
    FROM public.user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND OR v_credit.balance < v_credit_amount THEN
      RAISE EXCEPTION 'Insufficient user credit'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_gift_amount > 0 THEN
    UPDATE public.gift_cards
    SET
      balance = v_gc_available - v_gift_amount,
      remaining_balance = v_gc_available - v_gift_amount,
      is_active = (v_gc_available - v_gift_amount) > 0
    WHERE id = v_gc.id;
  END IF;

  IF v_credit_amount > 0 THEN
    UPDATE public.user_credits
    SET
      balance = v_credit.balance - v_credit_amount,
      updated_at = NOW()
    WHERE id = v_credit.id;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.checkout_value_reservations (
      reservation_key,
      user_id,
      items,
      credit_amount,
      credit_balance_before,
      credit_balance_after,
      gift_card_id,
      gift_card_amount,
      promotion_id,
      status,
      expires_at
    )
    VALUES (
      TRIM(p_reservation_key),
      p_user_id,
      p_items,
      v_credit_amount,
      CASE WHEN v_credit_amount > 0 THEN v_credit.balance ELSE NULL END,
      CASE WHEN v_credit_amount > 0 THEN v_credit.balance - v_credit_amount ELSE NULL END,
      CASE WHEN v_gift_amount > 0 THEN v_gc.id ELSE NULL END,
      v_gift_amount,
      v_promo.id,
      'reserved',
      NOW() + INTERVAL '35 minutes'
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.checkout_value_reservations
    SET
      stripe_session_id = NULL,
      order_id = NULL,
      items = p_items,
      credit_amount = v_credit_amount,
      credit_balance_before =
        CASE WHEN v_credit_amount > 0 THEN v_credit.balance ELSE NULL END,
      credit_balance_after =
        CASE WHEN v_credit_amount > 0 THEN v_credit.balance - v_credit_amount ELSE NULL END,
      gift_card_id = CASE WHEN v_gift_amount > 0 THEN v_gc.id ELSE NULL END,
      gift_card_amount = v_gift_amount,
      promotion_id = v_promo.id,
      status = 'reserved',
      expires_at = NOW() + INTERVAL '35 minutes',
      release_reason = NULL,
      released_at = NULL,
      consumed_at = NULL,
      refunded_at = NULL,
      updated_at = NOW()
    WHERE id = v_existing.id
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', v_id,
    'expires_at', NOW() + INTERVAL '35 minutes',
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.bind_checkout_value_reservation(
  p_reservation_id UUID,
  p_stripe_session_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NULLIF(TRIM(p_stripe_session_id), '') IS NULL THEN
    RAISE EXCEPTION 'Stripe session ID is required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.checkout_value_reservations
  SET
    stripe_session_id = TRIM(p_stripe_session_id),
    updated_at = NOW()
  WHERE id = p_reservation_id
    AND status = 'reserved'
    AND expires_at > NOW()
    AND (
      stripe_session_id IS NULL
      OR stripe_session_id = TRIM(p_stripe_session_id)
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Checkout reservation cannot be bound'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- A delayed-notification payment can remain in Stripe's processing state for
-- several days after checkout.session.completed. Keep its stock/internal value
-- reservation alive without fulfilling until async_payment_succeeded arrives.
CREATE OR REPLACE FUNCTION public.extend_checkout_reservation_for_async_payment(
  p_stripe_session_id TEXT,
  p_hold_minutes INTEGER DEFAULT 10080
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
  v_hold_minutes INTEGER :=
    LEAST(GREATEST(COALESCE(p_hold_minutes, 10080), 60), 20160);
BEGIN
  IF NULLIF(TRIM(p_stripe_session_id), '') IS NULL THEN
    RAISE EXCEPTION 'Stripe session ID is required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.checkout_value_reservations
  SET
    expires_at = GREATEST(
      expires_at,
      created_at + make_interval(mins => v_hold_minutes)
    ),
    updated_at = NOW()
  WHERE stripe_session_id = TRIM(p_stripe_session_id)
    AND status = 'reserved';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Async payment reservation cannot be extended'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'hold_minutes', v_hold_minutes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_expired_checkout_reservations(
  p_limit INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row RECORD;
  v_released INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT id
    FROM public.checkout_value_reservations
    WHERE status = 'reserved'
      AND expires_at <= NOW()
    ORDER BY expires_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.release_checkout_value_reservation(
      v_row.id,
      'reservation_expired'
    );
    v_released := v_released + 1;
  END LOOP;

  RETURN v_released;
END;
$$;

-- Use the provider scheduler when pg_cron is already enabled. The checkout
-- function also performs bounded opportunistic cleanup, and Stripe expiry
-- webhooks remain the primary release path.
DO $$
DECLARE
  v_job_exists BOOLEAN;
  v_job_id BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = $1)'
    INTO v_job_exists
    USING 'release-expired-checkout-reservations';

    IF NOT v_job_exists THEN
      EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      INTO v_job_id
      USING
        'release-expired-checkout-reservations',
        '*/5 * * * *',
        'SELECT public.release_expired_checkout_reservations(100);';
    END IF;
  END IF;
END $$;

-- Gift-card validation returns only what is needed to render an availability
-- result. Bearer code, QR token and personal message data are not reflected by
-- this public RPC.
CREATE OR REPLACE FUNCTION public.validate_gift_card_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gift public.gift_cards%ROWTYPE;
  v_available NUMERIC(10,2);
BEGIN
  IF char_length(TRIM(COALESCE(p_code, ''))) NOT BETWEEN 10 AND 64 THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Codice non valido');
  END IF;

  SELECT *
  INTO v_gift
  FROM public.gift_cards
  WHERE REPLACE(UPPER(code), '-', '') =
    REPLACE(UPPER(TRIM(p_code)), '-', '')
  LIMIT 1;

  IF NOT FOUND
    OR NOT v_gift.is_active
    OR COALESCE(v_gift.is_redeemed, false)
    OR (v_gift.expires_at IS NOT NULL AND v_gift.expires_at <= NOW())
  THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Codice non trovato, scaduto o non attivo'
    );
  END IF;

  v_available := GREATEST(
    0,
    LEAST(
      COALESCE(v_gift.remaining_balance, v_gift.balance, v_gift.amount),
      COALESCE(v_gift.balance, v_gift.amount),
      v_gift.amount
    )
  );

  IF v_available <= 0 THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Gift card esaurita');
  END IF;

  RETURN jsonb_build_object('valid', true, 'balance', v_available);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_gift_card_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_gift_card_code(TEXT)
  TO anon, authenticated, service_role;

-- QR links are bearer capabilities, so the preview can expose the visual gift
-- card content but must not reflect its database identifier or the QR token
-- itself. The display code remains intentional: it is the alternate bearer
-- credential delivered to the recipient and rendered on the gift card.
CREATE OR REPLACE FUNCTION public.get_gift_card_by_token(p_qr_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_gift public.gift_cards%ROWTYPE;
  v_available NUMERIC(10,2);
BEGIN
  IF p_qr_token IS NULL THEN
    RETURN jsonb_build_object('error', 'Gift card non trovata');
  END IF;

  SELECT *
  INTO v_gift
  FROM public.gift_cards
  WHERE qr_code_token = p_qr_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Gift card non trovata');
  END IF;

  v_available := GREATEST(
    0,
    LEAST(
      COALESCE(v_gift.remaining_balance, v_gift.balance, v_gift.amount),
      COALESCE(v_gift.balance, v_gift.amount),
      v_gift.amount
    )
  );

  RETURN jsonb_build_object(
    'giftCard', jsonb_build_object(
      'code', v_gift.code,
      'amount', v_gift.amount,
      'balance', v_available,
      'remaining_balance', v_available,
      'recipient_name', v_gift.recipient_name,
      'sender_name', v_gift.sender_name,
      'message', v_gift.message,
      'template', v_gift.template,
      'is_active', v_gift.is_active,
      'is_redeemed', v_gift.is_redeemed,
      'expires_at', v_gift.expires_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_gift_card_by_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gift_card_by_token(UUID)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.redeem_gift_card_value(
  p_qr_token UUID,
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_gift public.gift_cards%ROWTYPE;
  v_balance_before NUMERIC(10,2);
  v_balance_after NUMERIC(10,2);
  v_amount NUMERIC(10,2);
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Devi effettuare il login per riscattare la gift card'
    );
  END IF;

  IF (p_qr_token IS NULL) = (
    NULLIF(TRIM(COALESCE(p_code, '')), '') IS NULL
  ) OR (
    p_code IS NOT NULL
    AND char_length(TRIM(p_code)) NOT BETWEEN 10 AND 64
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Gift card non valida');
  END IF;

  SELECT *
  INTO v_gift
  FROM public.gift_cards
  WHERE (
    p_qr_token IS NOT NULL
    AND qr_code_token = p_qr_token
  ) OR (
    p_qr_token IS NULL
    AND REPLACE(UPPER(code), '-', '') =
      REPLACE(UPPER(TRIM(p_code)), '-', '')
  )
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Gift card non trovata');
  END IF;
  IF COALESCE(v_gift.is_redeemed, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Questa gift card è già stata riscattata'
    );
  END IF;
  IF NOT v_gift.is_active
    OR (v_gift.expires_at IS NOT NULL AND v_gift.expires_at <= NOW())
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Gift card non attiva o scaduta'
    );
  END IF;

  -- The gift-card row lock serializes this check with checkout reservation.
  -- Reject even an already-expired row until the bounded cleanup restores it.
  IF EXISTS (
    SELECT 1
    FROM public.checkout_value_reservations
    WHERE gift_card_id = v_gift.id
      AND status = 'reserved'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Gift card temporaneamente riservata da un pagamento in corso'
    );
  END IF;

  v_amount := GREATEST(
    0,
    LEAST(
      COALESCE(v_gift.remaining_balance, v_gift.balance, v_gift.amount),
      COALESCE(v_gift.balance, v_gift.amount),
      v_gift.amount
    )
  );
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Gift card esaurita');
  END IF;

  INSERT INTO public.user_credits (user_id, balance, total_earned)
  VALUES (v_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance
  INTO v_balance_before
  FROM public.user_credits
  WHERE user_id = v_user_id
  FOR UPDATE;

  v_balance_after := v_balance_before + v_amount;

  UPDATE public.user_credits
  SET
    balance = v_balance_after,
    total_earned = total_earned + v_amount,
    updated_at = NOW()
  WHERE user_id = v_user_id;

  UPDATE public.gift_cards
  SET
    is_redeemed = true,
    redeemed_by = v_user_id,
    redeemed_at = NOW(),
    balance = 0,
    remaining_balance = 0,
    is_active = false
  WHERE id = v_gift.id;

  INSERT INTO public.credit_transactions (
    user_id,
    amount,
    transaction_type,
    reference_id,
    reference_type,
    balance_before,
    balance_after,
    description
  )
  VALUES (
    v_user_id,
    v_amount,
    'gift_card_redeem',
    v_gift.id,
    'gift_card',
    v_balance_before,
    v_balance_after,
    'Riscatto gift card'
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'amount', v_amount,
    'new_balance', v_balance_after
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_gift_card(p_qr_token UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.redeem_gift_card_value(p_qr_token, NULL);
$$;

CREATE OR REPLACE FUNCTION public.redeem_gift_card_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.redeem_gift_card_value(NULL, p_code);
$$;

REVOKE ALL ON FUNCTION public.redeem_gift_card_value(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_gift_card(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_gift_card_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_gift_card(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_gift_card_by_code(TEXT)
  TO authenticated, service_role;

-- ============================================================
-- PROMOTION, CREDIT AND REFERRAL PRIVILEGE FIXES
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_promotion_usage(p_code TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.promotions
  SET
    usage_count = COALESCE(usage_count, 0) + 1,
    updated_at = NOW()
  WHERE code = UPPER(TRIM(p_code))
    AND is_active
    AND NOW() BETWEEN starts_at AND ends_at
    AND (
      usage_limit IS NULL
      OR COALESCE(usage_count, 0) < usage_limit
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Promotion cannot be consumed'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_promotion_usage(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_promotion_usage(TEXT) TO service_role;

-- Legacy direct credit spending is no longer a client capability. Checkout
-- uses reserve_checkout_value and atomic fulfillment instead.
-- The historical chain used both JSON and JSONB as the return type for this
-- signature. Recreate it explicitly because CREATE OR REPLACE cannot change
-- a function return type.
DROP FUNCTION IF EXISTS public.use_credits(UUID, DECIMAL, UUID);

CREATE OR REPLACE FUNCTION public.use_credits(
  p_user_id UUID,
  p_amount DECIMAL,
  p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL
    OR p_order_id IS NULL
    OR p_amount IS NULL
    OR p_amount <= 0
    OR ROUND(p_amount, 2) <> p_amount
  THEN
    RAISE EXCEPTION 'Invalid credit amount'
      USING ERRCODE = '22023';
  END IF;

  RAISE EXCEPTION 'Direct credit spending is disabled; use checkout reservation'
    USING ERRCODE = '0A000';
END;
$$;

REVOKE ALL ON FUNCTION public.use_credits(UUID, DECIMAL, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_credits(UUID, DECIMAL, UUID) TO service_role;

-- Harden compatibility paths for sessions created immediately before this
-- migration. They never clamp an insufficient balance to zero.
CREATE OR REPLACE FUNCTION public.redeem_order_gift_card(p_order_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_gift public.gift_cards%ROWTYPE;
  v_available NUMERIC(10,2);
  v_new_balance NUMERIC(10,2);
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Ordine non trovato');
  END IF;
  IF v_order.gift_card_redeemed THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;
  IF v_order.gift_card_code IS NULL OR COALESCE(v_order.gift_card_amount, 0) <= 0 THEN
    UPDATE public.orders
    SET gift_card_redeemed = true, updated_at = NOW()
    WHERE id = p_order_id;
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  SELECT *
  INTO v_gift
  FROM public.gift_cards
  WHERE REPLACE(UPPER(code), '-', '') =
    REPLACE(UPPER(v_order.gift_card_code), '-', '')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Gift card non trovata');
  END IF;

  v_available := GREATEST(
    0,
    LEAST(
      COALESCE(v_gift.remaining_balance, v_gift.balance, v_gift.amount),
      COALESCE(v_gift.balance, v_gift.amount),
      v_gift.amount
    )
  );

  IF v_available < v_order.gift_card_amount THEN
    RETURN json_build_object('success', false, 'error', 'Saldo gift card insufficiente');
  END IF;

  v_new_balance := v_available - v_order.gift_card_amount;
  UPDATE public.gift_cards
  SET
    balance = v_new_balance,
    remaining_balance = v_new_balance,
    is_active = v_new_balance > 0
  WHERE id = v_gift.id;

  UPDATE public.orders
  SET gift_card_redeemed = true, updated_at = NOW()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_order_user_credit(p_order_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_credit public.user_credits%ROWTYPE;
  v_new_balance NUMERIC(10,2);
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Ordine non trovato');
  END IF;
  IF v_order.user_credit_deducted THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;
  IF COALESCE(v_order.user_credit_amount, 0) <= 0 THEN
    UPDATE public.orders
    SET user_credit_deducted = true, updated_at = NOW()
    WHERE id = p_order_id;
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  SELECT *
  INTO v_credit
  FROM public.user_credits
  WHERE user_id = v_order.user_id
  FOR UPDATE;

  IF NOT FOUND OR v_credit.balance < v_order.user_credit_amount THEN
    RETURN json_build_object('success', false, 'error', 'Credito utente insufficiente');
  END IF;

  v_new_balance := v_credit.balance - v_order.user_credit_amount;
  UPDATE public.user_credits
  SET
    balance = v_new_balance,
    total_spent = total_spent + v_order.user_credit_amount,
    updated_at = NOW()
  WHERE id = v_credit.id;

  INSERT INTO public.credit_transactions (
    user_id, amount, transaction_type, reference_id, reference_type,
    balance_before, balance_after, description
  )
  VALUES (
    v_order.user_id, -v_order.user_credit_amount, 'purchase', p_order_id, 'order',
    v_credit.balance, v_new_balance, 'Pagamento ordine #' || v_order.order_number
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.orders
  SET user_credit_deducted = true, updated_at = NOW()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_referral_conversion(
  p_referee_id UUID,
  p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_ip_count INTEGER;
  v_max_per_ip INTEGER := 3;
  v_min_order_amount NUMERIC(10,2) := 35;
  v_current_balance NUMERIC(10,2);
  v_new_balance NUMERIC(10,2);
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_order.user_id IS DISTINCT FROM p_referee_id
    OR v_order.payment_status <> 'completed'
    OR v_order.status NOT IN ('confirmed', 'processing', 'shipped', 'delivered')
  THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_paid_order');
  END IF;

  SELECT *
  INTO v_referral
  FROM public.referrals
  WHERE referee_id = p_referee_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_pending_referral');
  END IF;

  -- Only the first successfully paid order can convert a referral.
  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE user_id = p_referee_id
      AND payment_status = 'completed'
      AND id <> p_order_id
      AND created_at <= v_order.created_at
  ) THEN
    UPDATE public.referrals
    SET
      status = 'converted',
      converted_at = NOW(),
      converted_order_id = p_order_id,
      reward_credited = false
    WHERE id = v_referral.id;

    RETURN jsonb_build_object(
      'success', true,
      'reward_credited', false,
      'reason', 'not_first_paid_order'
    );
  END IF;

  SELECT COALESCE((value->>'amount')::NUMERIC, 35)
  INTO v_min_order_amount
  FROM public.system_config
  WHERE key = 'referral_minimum_order';

  IF v_order.subtotal < COALESCE(v_min_order_amount, 35) THEN
    UPDATE public.referrals
    SET
      status = 'converted',
      converted_at = NOW(),
      converted_order_id = p_order_id,
      reward_credited = false
    WHERE id = v_referral.id;

    RETURN jsonb_build_object(
      'success', true,
      'reward_credited', false,
      'reason', 'minimum_order_not_met'
    );
  END IF;

  SELECT COALESCE((value->>'max_per_ip_daily')::INTEGER, 3)
  INTO v_max_per_ip
  FROM public.system_config
  WHERE key = 'referral_limits';

  SELECT COUNT(*)::INTEGER
  INTO v_ip_count
  FROM public.referrals
  WHERE ip_address IS NOT DISTINCT FROM v_referral.ip_address
    AND status = 'converted'
    AND converted_at >= DATE_TRUNC('day', NOW());

  IF v_ip_count >= COALESCE(v_max_per_ip, 3) THEN
    UPDATE public.referrals
    SET
      status = 'converted',
      converted_at = NOW(),
      converted_order_id = p_order_id,
      reward_credited = false
    WHERE id = v_referral.id;

    RETURN jsonb_build_object(
      'success', true,
      'reward_credited', false,
      'reason', 'ip_limit_exceeded'
    );
  END IF;

  INSERT INTO public.user_credits(user_id, balance, total_earned, total_spent)
  VALUES (v_referral.referrer_id, 0, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance
  INTO v_current_balance
  FROM public.user_credits
  WHERE user_id = v_referral.referrer_id
  FOR UPDATE;

  v_new_balance := v_current_balance + v_referral.reward_amount;

  UPDATE public.user_credits
  SET
    balance = v_new_balance,
    total_earned = total_earned + v_referral.reward_amount,
    updated_at = NOW()
  WHERE user_id = v_referral.referrer_id;

  INSERT INTO public.credit_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    reference_id,
    reference_type,
    balance_before,
    balance_after
  )
  VALUES (
    v_referral.referrer_id,
    v_referral.reward_amount,
    'referral_reward',
    'Reward per referral convertito',
    v_referral.id,
    'referral',
    v_current_balance,
    v_new_balance
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.referrals
  SET
    status = 'converted',
    converted_at = NOW(),
    converted_order_id = p_order_id,
    reward_credited = true
  WHERE id = v_referral.id;

  UPDATE public.user_referral_codes
  SET
    total_conversions = total_conversions + 1,
    total_earned = total_earned + v_referral.reward_amount
  WHERE user_id = v_referral.referrer_id;

  RETURN jsonb_build_object(
    'success', true,
    'reward_credited', true,
    'referrer_id', v_referral.referrer_id,
    'reward_amount', v_referral.reward_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_referral_conversion(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_conversion(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_referral_reward(
  p_order_id UUID,
  p_reason TEXT DEFAULT 'order_refunded'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_referral public.referrals%ROWTYPE;
  v_refund_window INTEGER := 14;
  v_balance_before NUMERIC(10,2);
  v_balance_after NUMERIC(10,2);
  v_actual_deduction NUMERIC(10,2);
BEGIN
  SELECT *
  INTO v_referral
  FROM public.referrals
  WHERE converted_order_id = p_order_id
    AND status = 'converted'
    AND reward_credited
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  SELECT COALESCE((value->>'refund_window_days')::INTEGER, 14)
  INTO v_refund_window
  FROM public.system_config
  WHERE key = 'referral_limits';

  IF v_referral.converted_at
      + make_interval(days => COALESCE(v_refund_window, 14)) < NOW()
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'outside_refund_window'
    );
  END IF;

  SELECT balance
  INTO v_balance_before
  FROM public.user_credits
  WHERE user_id = v_referral.referrer_id
  FOR UPDATE;

  v_balance_before := COALESCE(v_balance_before, 0);
  v_actual_deduction := LEAST(v_balance_before, v_referral.reward_amount);
  v_balance_after := v_balance_before - v_actual_deduction;

  UPDATE public.user_credits
  SET
    balance = v_balance_after,
    total_earned = GREATEST(0, total_earned - v_referral.reward_amount),
    updated_at = NOW()
  WHERE user_id = v_referral.referrer_id;

  INSERT INTO public.credit_transactions (
    user_id,
    amount,
    transaction_type,
    description,
    reference_id,
    reference_type,
    balance_before,
    balance_after
  )
  VALUES (
    v_referral.referrer_id,
    -v_actual_deduction,
    'referral_revoked',
    CASE
      WHEN v_actual_deduction < v_referral.reward_amount
      THEN 'Revoca referral parziale: credito già utilizzato'
      ELSE 'Revoca reward per rimborso ordine'
    END,
    v_referral.id,
    'referral',
    v_balance_before,
    v_balance_after
  )
  ON CONFLICT DO NOTHING;

  UPDATE public.referrals
  SET
    status = 'revoked',
    reward_credited = false,
    revoked_at = NOW(),
    revoke_reason = LEFT(COALESCE(NULLIF(TRIM(p_reason), ''), 'order_refunded'), 200)
  WHERE id = v_referral.id;

  UPDATE public.user_referral_codes
  SET
    total_conversions = GREATEST(0, total_conversions - 1),
    total_earned = GREATEST(0, total_earned - v_referral.reward_amount)
  WHERE user_id = v_referral.referrer_id;

  RETURN jsonb_build_object(
    'success', true,
    'referrer_id', v_referral.referrer_id,
    'amount_revoked', v_actual_deduction,
    'unrecovered_amount', v_referral.reward_amount - v_actual_deduction
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_referral_reward(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_referral_reward(UUID, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_gift_card_code(
  p_code TEXT,
  p_reason TEXT DEFAULT 'reserved'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code TEXT := REPLACE(UPPER(TRIM(COALESCE(p_code, ''))), '-', '');
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_code) NOT BETWEEN 10 AND 64 THEN
    RAISE EXCEPTION 'Invalid gift-card code' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.used_gift_card_codes(code, reason)
  VALUES (
    v_code,
    LEFT(COALESCE(NULLIF(TRIM(p_reason), ''), 'reserved'), 100)
  )
  ON CONFLICT (code) DO NOTHING;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_gift_card_code(TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_gift_card_code(TEXT, TEXT)
  TO authenticated, service_role;

-- ============================================================
-- CONSUME RESERVATION AND ATOMIC ORDER FINALIZATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.consume_checkout_value_reservation(
  p_order_id UUID,
  p_stripe_session_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_res public.checkout_value_reservations%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_credit_balance NUMERIC(10,2);
  v_count INTEGER;
BEGIN
  SELECT *
  INTO v_res
  FROM public.checkout_value_reservations
  WHERE stripe_session_id = p_stripe_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'reservation_not_found');
  END IF;

  IF v_res.status = 'consumed' AND v_res.order_id = p_order_id THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  IF v_res.status <> 'reserved' THEN
    RAISE EXCEPTION 'Checkout reservation is not consumable'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_order.user_id IS DISTINCT FROM v_res.user_id
    OR ROUND(COALESCE(v_order.user_credit_amount, 0), 2) <> v_res.credit_amount
    OR ROUND(COALESCE(v_order.gift_card_amount, 0), 2) <> v_res.gift_card_amount
  THEN
    RAISE EXCEPTION 'Order does not match checkout reservation'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_res.credit_amount > 0 THEN
    SELECT balance
    INTO v_credit_balance
    FROM public.user_credits
    WHERE user_id = v_res.user_id
    FOR UPDATE;

    UPDATE public.user_credits
    SET
      total_spent = total_spent + v_res.credit_amount,
      updated_at = NOW()
    WHERE user_id = v_res.user_id;

    INSERT INTO public.credit_transactions (
      user_id,
      amount,
      transaction_type,
      reference_id,
      reference_type,
      balance_before,
      balance_after,
      description
    )
    VALUES (
      v_res.user_id,
      -v_res.credit_amount,
      'purchase',
      p_order_id,
      'order',
      COALESCE(v_res.credit_balance_before, v_credit_balance + v_res.credit_amount),
      COALESCE(v_res.credit_balance_after, v_credit_balance),
      'Credito riservato e consumato per ordine'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_res.promotion_id IS NOT NULL THEN
    UPDATE public.promotions
    SET
      usage_count = COALESCE(usage_count, 0) + 1,
      updated_at = NOW()
    WHERE id = v_res.promotion_id
      AND (
        usage_limit IS NULL
        OR COALESCE(usage_count, 0) < usage_limit
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Reserved promotion cannot be consumed'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.orders
  SET
    gift_card_redeemed = true,
    user_credit_deducted = true,
    updated_at = NOW()
  WHERE id = p_order_id;

  UPDATE public.checkout_value_reservations
  SET
    status = 'consumed',
    order_id = p_order_id,
    consumed_at = NOW(),
    updated_at = NOW()
  WHERE id = v_res.id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Inventory fulfillment follows the same deterministic product -> weight-row
-- lock order used by checkout reservation. This avoids a product/weight lock
-- inversion when the weight trigger updates its parent product.
CREATE OR REPLACE FUNCTION public.process_order_inventory(p_order_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_already BOOLEAN;
  v_item RECORD;
  v_available INTEGER;
  v_shortages JSONB := '[]'::JSONB;
BEGIN
  SELECT inventory_decremented
  INTO v_already
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Ordine non trovato');
  END IF;
  IF v_already THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  -- Lock every affected parent before any weight row. The trigger on
  -- weight_inventory later reuses these locks in the same transaction.
  PERFORM product.id
  FROM public.products AS product
  JOIN (
    SELECT DISTINCT item.product_id
    FROM public.order_items AS item
    WHERE item.order_id = p_order_id
      AND item.product_id IS NOT NULL
  ) AS affected ON affected.product_id = product.id
  ORDER BY product.id
  FOR UPDATE OF product;

  FOR v_item IN
    SELECT
      item.product_id,
      MIN(item.product_name) AS product_name,
      item.weight_grams,
      SUM(item.quantity)::INTEGER AS quantity
    FROM public.order_items AS item
    WHERE item.order_id = p_order_id
      AND item.product_id IS NOT NULL
    GROUP BY item.product_id, item.weight_grams
    ORDER BY item.product_id, item.weight_grams NULLS FIRST
  LOOP
    IF v_item.weight_grams IS NOT NULL THEN
      SELECT quantity
      INTO v_available
      FROM public.weight_inventory
      WHERE product_id = v_item.product_id
        AND weight_grams = v_item.weight_grams
      FOR UPDATE;

      IF NOT FOUND THEN
        v_shortages := v_shortages || jsonb_build_object(
          'product_id', v_item.product_id,
          'product_name', v_item.product_name,
          'weight_grams', v_item.weight_grams,
          'requested', v_item.quantity,
          'available', 0,
          'reason', 'variante peso non trovata'
        );
      ELSE
        IF v_available < v_item.quantity THEN
          v_shortages := v_shortages || jsonb_build_object(
            'product_id', v_item.product_id,
            'product_name', v_item.product_name,
            'weight_grams', v_item.weight_grams,
            'requested', v_item.quantity,
            'available', v_available,
            'reason', 'stock insufficiente'
          );
        END IF;

        UPDATE public.weight_inventory
        SET quantity = GREATEST(quantity - v_item.quantity, 0)
        WHERE product_id = v_item.product_id
          AND weight_grams = v_item.weight_grams;
      END IF;
    ELSE
      SELECT num_items
      INTO v_available
      FROM public.products
      WHERE id = v_item.product_id;

      -- NULL means the product is not tracked by individual piece count.
      IF v_available IS NOT NULL THEN
        IF v_available < v_item.quantity THEN
          v_shortages := v_shortages || jsonb_build_object(
            'product_id', v_item.product_id,
            'product_name', v_item.product_name,
            'requested', v_item.quantity,
            'available', v_available,
            'reason', 'stock insufficiente'
          );
        END IF;

        UPDATE public.products
        SET
          num_items = GREATEST(num_items - v_item.quantity, 0),
          is_active = CASE
            WHEN GREATEST(num_items - v_item.quantity, 0) = 0 THEN false
            ELSE is_active
          END
        WHERE id = v_item.product_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.orders
  SET inventory_decremented = true, updated_at = NOW()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'shortages', v_shortages);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_order_inventory(p_order_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_decremented BOOLEAN;
  v_item RECORD;
BEGIN
  SELECT inventory_decremented
  INTO v_decremented
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Ordine non trovato');
  END IF;
  IF NOT v_decremented THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  PERFORM product.id
  FROM public.products AS product
  JOIN (
    SELECT DISTINCT item.product_id
    FROM public.order_items AS item
    WHERE item.order_id = p_order_id
      AND item.product_id IS NOT NULL
  ) AS affected ON affected.product_id = product.id
  ORDER BY product.id
  FOR UPDATE OF product;

  FOR v_item IN
    SELECT
      item.product_id,
      item.weight_grams,
      SUM(item.quantity)::INTEGER AS quantity
    FROM public.order_items AS item
    WHERE item.order_id = p_order_id
      AND item.product_id IS NOT NULL
    GROUP BY item.product_id, item.weight_grams
    ORDER BY item.product_id, item.weight_grams NULLS FIRST
  LOOP
    IF v_item.weight_grams IS NOT NULL THEN
      UPDATE public.weight_inventory
      SET quantity = quantity + v_item.quantity
      WHERE product_id = v_item.product_id
        AND weight_grams = v_item.weight_grams;

      IF NOT FOUND THEN
        INSERT INTO public.weight_inventory (
          product_id,
          weight_grams,
          quantity
        )
        VALUES (
          v_item.product_id,
          v_item.weight_grams,
          v_item.quantity
        );
      END IF;
    ELSE
      UPDATE public.products
      SET num_items = num_items + v_item.quantity
      WHERE id = v_item.product_id
        AND num_items IS NOT NULL;
    END IF;
  END LOOP;

  UPDATE public.orders
  SET inventory_decremented = false, updated_at = NOW()
  WHERE id = p_order_id;

  RETURN json_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.process_order_inventory(UUID) IS
  'Idempotently decrements paid-order stock using deterministic product then variant locking';
COMMENT ON FUNCTION public.restore_order_inventory(UUID) IS
  'Idempotently restores order stock using deterministic product then variant locking';

CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  p_stripe_session_id TEXT,
  p_payment_id TEXT,
  p_user_id UUID,
  p_stripe_amount_total BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pending public.pending_checkout_sessions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_item JSONB;
  v_expected_items INTEGER;
  v_inserted_items INTEGER;
  v_created BOOLEAN := false;
  v_inventory JSONB := '{}'::JSONB;
  v_reservation JSONB := '{}'::JSONB;
  v_referral JSONB := '{}'::JSONB;
BEGIN
  IF NULLIF(TRIM(p_stripe_session_id), '') IS NULL
    OR NULLIF(TRIM(p_payment_id), '') IS NULL
    OR p_user_id IS NULL
    OR p_stripe_amount_total IS NULL
    OR p_stripe_amount_total < 0
  THEN
    RAISE EXCEPTION 'Invalid paid Checkout identifiers'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_pending
  FROM public.pending_checkout_sessions
  WHERE stripe_session_id = TRIM(p_stripe_session_id)
  FOR UPDATE;

  IF NOT FOUND
    OR v_pending.checkout_type <> 'order'
    OR v_pending.user_id IS DISTINCT FROM p_user_id
    OR jsonb_typeof(v_pending.items) <> 'array'
    OR jsonb_array_length(v_pending.items) NOT BETWEEN 1 AND 100
    OR ROUND(v_pending.total * 100)::BIGINT <> p_stripe_amount_total
  THEN
    RAISE EXCEPTION 'Stripe payment does not match the server checkout snapshot'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_pending.total < 0
    OR v_pending.subtotal < 0
    OR v_pending.shipping_cost < 0
    OR v_pending.discount_amount < 0
    OR v_pending.gift_card_amount < 0
    OR v_pending.user_credit_amount < 0
    OR ABS(
      v_pending.total - (
        v_pending.subtotal + v_pending.shipping_cost
        - v_pending.discount_amount
        - v_pending.gift_card_amount
        - v_pending.user_credit_amount
      )
    ) > 0.01
  THEN
    RAISE EXCEPTION 'Checkout amount snapshot is inconsistent'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_pending.items)
  LOOP
    IF NULLIF(v_item->>'product_id', '') IS NULL
      OR NULLIF(v_item->>'product_name', '') IS NULL
      OR COALESCE((v_item->>'product_price')::NUMERIC, 0) <= 0
      OR COALESCE((v_item->>'quantity')::INTEGER, 0) NOT BETWEEN 1 AND 10
      OR char_length(v_item->>'product_name') > 300
      OR (
        NULLIF(v_item->>'weight_grams', '') IS NOT NULL
        AND (v_item->>'weight_grams')::INTEGER <= 0
      )
    THEN
      RAISE EXCEPTION 'Invalid order line in checkout snapshot'
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE payment_id = TRIM(p_payment_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.orders (
        user_id,
        order_number,
        status,
        subtotal,
        discount,
        shipping_cost,
        total,
        shipping_address,
        payment_provider,
        payment_id,
        payment_status,
        gift_card_code,
        gift_card_amount,
        user_credit_amount,
        gift_card_redeemed,
        user_credit_deducted,
        inventory_decremented
      )
      VALUES (
        p_user_id,
        'MF-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-'
          || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 10)),
        'confirmed',
        v_pending.subtotal,
        v_pending.discount_amount
          + v_pending.gift_card_amount
          + v_pending.user_credit_amount,
        v_pending.shipping_cost,
        v_pending.total,
        COALESCE(v_pending.shipping_address, '{}'::JSONB),
        'stripe',
        TRIM(p_payment_id),
        'completed',
        v_pending.gift_card_code,
        v_pending.gift_card_amount,
        v_pending.user_credit_amount,
        false,
        false,
        false
      )
      RETURNING * INTO v_order;

      v_created := true;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
      INTO v_order
      FROM public.orders
      WHERE payment_id = TRIM(p_payment_id)
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE;
      END IF;
    END;
  END IF;

  IF v_order.user_id IS DISTINCT FROM p_user_id
    OR ROUND(v_order.total * 100)::BIGINT <> p_stripe_amount_total
  THEN
    RAISE EXCEPTION 'Existing payment order does not match Stripe'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_inserted_items
  FROM public.order_items
  WHERE order_id = v_order.id;

  IF v_inserted_items = 0 THEN
    INSERT INTO public.order_items (
      order_id,
      product_id,
      product_name,
      product_price,
      product_image,
      size,
      color,
      quantity,
      weight_grams,
      unit_measure
    )
    SELECT
      v_order.id,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.products
          WHERE id = (item->>'product_id')::UUID
        )
        THEN (item->>'product_id')::UUID
        ELSE NULL
      END,
      LEFT(item->>'product_name', 300),
      ROUND((item->>'product_price')::NUMERIC, 2),
      NULLIF(item->>'image', ''),
      LEFT(COALESCE(NULLIF(item->>'size', ''), 'Standard'), 100),
      LEFT(COALESCE(NULLIF(item->>'color', ''), 'Fresco'), 100),
      (item->>'quantity')::INTEGER,
      NULLIF(item->>'weight_grams', '')::INTEGER,
      CASE
        WHEN NULLIF(item->>'weight_grams', '') IS NULL THEN 'pz'
        ELSE 'kg'
      END
    FROM jsonb_array_elements(v_pending.items) AS item;
  END IF;

  v_expected_items := jsonb_array_length(v_pending.items);
  SELECT COUNT(*)::INTEGER
  INTO v_inserted_items
  FROM public.order_items
  WHERE order_id = v_order.id;

  IF v_inserted_items <> v_expected_items THEN
    RAISE EXCEPTION 'Order item count does not match checkout snapshot'
      USING ERRCODE = 'P0001';
  END IF;

  v_inventory := public.process_order_inventory(v_order.id)::JSONB;
  IF COALESCE((v_inventory->>'success')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Inventory processing failed'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT public.consume_checkout_value_reservation(
    v_order.id,
    p_stripe_session_id
  )
  INTO v_reservation;

  IF COALESCE((v_reservation->>'success')::BOOLEAN, false) IS NOT TRUE THEN
    -- Compatibility for sessions created immediately before migration 028.
    IF v_pending.gift_card_amount > 0 THEN
      v_reservation := public.redeem_order_gift_card(v_order.id)::JSONB;
      IF COALESCE((v_reservation->>'success')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Legacy gift-card consumption failed'
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      UPDATE public.orders
      SET gift_card_redeemed = true
      WHERE id = v_order.id;
    END IF;

    IF v_pending.user_credit_amount > 0 THEN
      v_reservation := public.deduct_order_user_credit(v_order.id)::JSONB;
      IF COALESCE((v_reservation->>'success')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Legacy user-credit consumption failed'
          USING ERRCODE = 'P0001';
      END IF;
    ELSE
      UPDATE public.orders
      SET user_credit_deducted = true
      WHERE id = v_order.id;
    END IF;

    IF v_pending.promotion_code IS NOT NULL THEN
      PERFORM public.increment_promotion_usage(v_pending.promotion_code);
    END IF;
  END IF;

  v_referral := public.process_referral_conversion(p_user_id, v_order.id);

  DELETE FROM public.cart_items
  WHERE user_id = p_user_id;

  UPDATE public.pending_checkout_sessions
  SET
    stripe_payment_id = TRIM(p_payment_id),
    status = 'completed',
    completed_at = COALESCE(completed_at, NOW()),
    updated_at = NOW()
  WHERE id = v_pending.id;

  RETURN jsonb_build_object(
    'success', true,
    'created', v_created,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'inventory', v_inventory,
    'referral', v_referral
  );
END;
$$;

-- ============================================================
-- ATOMIC GIFT-CARD PURCHASE FINALIZATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_paid_gift_card(
  p_stripe_session_id TEXT,
  p_payment_id TEXT,
  p_user_id UUID,
  p_stripe_amount_total BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pending public.pending_checkout_sessions%ROWTYPE;
  v_existing public.gift_cards%ROWTYPE;
  v_gift public.gift_cards%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_amount NUMERIC(10,2);
  v_recipient_name TEXT;
  v_recipient_email TEXT;
  v_sender_name TEXT;
  v_message TEXT;
  v_template TEXT;
  v_code TEXT;
  v_attempt INTEGER := 0;
  v_created BOOLEAN := false;
BEGIN
  SELECT *
  INTO v_pending
  FROM public.pending_checkout_sessions
  WHERE stripe_session_id = TRIM(p_stripe_session_id)
  FOR UPDATE;

  IF NOT FOUND
    OR v_pending.checkout_type <> 'gift_card'
    OR v_pending.user_id IS DISTINCT FROM p_user_id
    OR ROUND(v_pending.total * 100)::BIGINT <> p_stripe_amount_total
  THEN
    RAISE EXCEPTION 'Gift-card payment does not match checkout snapshot'
      USING ERRCODE = 'P0001';
  END IF;

  v_amount := ROUND(COALESCE((v_pending.metadata->>'amount')::NUMERIC, 0), 2);
  v_recipient_name := LEFT(TRIM(COALESCE(v_pending.metadata->>'recipientName', '')), 120);
  v_recipient_email := LOWER(LEFT(TRIM(COALESCE(v_pending.metadata->>'recipientEmail', '')), 254));
  v_sender_name := LEFT(TRIM(COALESCE(v_pending.metadata->>'senderName', '')), 120);
  v_message := NULLIF(LEFT(TRIM(COALESCE(v_pending.metadata->>'message', '')), 500), '');
  v_template := LEFT(COALESCE(NULLIF(TRIM(v_pending.metadata->>'template'), ''), 'elegant'), 40);

  IF v_amount < 10
    OR v_amount > 500
    OR ROUND(v_amount * 100)::BIGINT <> p_stripe_amount_total
    OR v_recipient_name = ''
    OR v_sender_name = ''
    OR v_recipient_email !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$'
  THEN
    RAISE EXCEPTION 'Invalid gift-card snapshot'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.gift_cards
  WHERE stripe_session_id = p_stripe_session_id
    OR stripe_payment_id = p_payment_id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.pending_checkout_sessions
    SET
      stripe_payment_id = p_payment_id,
      status = 'completed',
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW()
    WHERE id = v_pending.id;

    RETURN jsonb_build_object(
      'success', true,
      'created', false,
      'gift_card_id', v_existing.id,
      'order_id', v_existing.purchased_order_id
    );
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE payment_id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.orders (
        user_id,
        order_number,
        status,
        subtotal,
        discount,
        shipping_cost,
        total,
        shipping_address,
        payment_provider,
        payment_id,
        payment_status,
        notes,
        gift_card_redeemed,
        user_credit_deducted,
        inventory_decremented
      )
      VALUES (
        p_user_id,
        'MF-GC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-'
          || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 10)),
        'confirmed',
        v_amount,
        0,
        0,
        v_amount,
        '{"type":"digital","note":"Gift Card - Consegna digitale"}'::JSONB,
        'stripe',
        p_payment_id,
        'completed',
        'Acquisto gift card digitale',
        true,
        true,
        true
      )
      RETURNING * INTO v_order;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
      INTO v_order
      FROM public.orders
      WHERE payment_id = p_payment_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE;
      END IF;
    END;
  END IF;

  IF v_order.user_id IS DISTINCT FROM p_user_id
    OR ROUND(v_order.total * 100)::BIGINT <> p_stripe_amount_total
  THEN
    RAISE EXCEPTION 'Existing gift-card order does not match Stripe'
      USING ERRCODE = 'P0001';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_code := public.generate_gift_card_code();

    BEGIN
      INSERT INTO public.gift_cards (
        code,
        qr_code_token,
        amount,
        balance,
        remaining_balance,
        recipient_name,
        recipient_email,
        sender_name,
        message,
        template,
        purchased_by,
        purchased_order_id,
        stripe_session_id,
        stripe_payment_id,
        is_active,
        expires_at
      )
      VALUES (
        v_code,
        gen_random_uuid(),
        v_amount,
        v_amount,
        v_amount,
        v_recipient_name,
        v_recipient_email,
        v_sender_name,
        v_message,
        v_template,
        p_user_id,
        v_order.id,
        p_stripe_session_id,
        p_payment_id,
        true,
        NOW() + INTERVAL '1 year'
      )
      RETURNING * INTO v_gift;

      v_created := true;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
      INTO v_existing
      FROM public.gift_cards
      WHERE stripe_session_id = p_stripe_session_id
        OR stripe_payment_id = p_payment_id
      LIMIT 1;

      IF FOUND THEN
        v_gift := v_existing;
        EXIT;
      END IF;

      IF v_attempt >= 10 THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  UPDATE public.pending_checkout_sessions
  SET
    stripe_payment_id = p_payment_id,
    status = 'completed',
    completed_at = COALESCE(completed_at, NOW()),
    updated_at = NOW()
  WHERE id = v_pending.id;

  RETURN jsonb_build_object(
    'success', true,
    'created', v_created,
    'gift_card_id', v_gift.id,
    'order_id', v_order.id
  );
END;
$$;

-- ============================================================
-- REFUNDS
-- Full refunds restore inventory and internally funded value exactly once.
-- Partial Stripe refunds intentionally require explicit business allocation.
-- ============================================================

CREATE OR REPLACE FUNCTION public.refund_paid_order(p_payment_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_res public.checkout_value_reservations%ROWTYPE;
  v_gift public.gift_cards%ROWTYPE;
  v_credit_before NUMERIC(10,2);
  v_credit_after NUMERIC(10,2);
  v_inventory JSONB;
  v_referral JSONB;
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE payment_id = NULLIF(TRIM(p_payment_id), '')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'order_not_found');
  END IF;

  IF v_order.payment_status = 'refunded' OR v_order.status = 'refunded' THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  -- Gift-card product purchase: invalidate the stored-value instrument.
  SELECT *
  INTO v_gift
  FROM public.gift_cards
  WHERE stripe_payment_id = p_payment_id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF COALESCE(v_gift.is_redeemed, false) AND v_gift.redeemed_by IS NOT NULL THEN
      SELECT balance
      INTO v_credit_before
      FROM public.user_credits
      WHERE user_id = v_gift.redeemed_by
      FOR UPDATE;

      v_credit_before := COALESCE(v_credit_before, 0);
      v_credit_after := GREATEST(0, v_credit_before - v_gift.amount);

      UPDATE public.user_credits
      SET
        balance = v_credit_after,
        total_earned = GREATEST(0, total_earned - v_gift.amount),
        updated_at = NOW()
      WHERE user_id = v_gift.redeemed_by;

      INSERT INTO public.credit_transactions (
        user_id,
        amount,
        transaction_type,
        reference_id,
        reference_type,
        balance_before,
        balance_after,
        description
      )
      VALUES (
        v_gift.redeemed_by,
        -(v_credit_before - v_credit_after),
        'refund',
        v_gift.id,
        'gift_card',
        v_credit_before,
        v_credit_after,
        'Revoca credito per rimborso acquisto gift card'
      )
      ON CONFLICT DO NOTHING;
    END IF;

    UPDATE public.gift_cards
    SET
      balance = 0,
      remaining_balance = 0,
      is_active = false
    WHERE id = v_gift.id;
  ELSE
    -- Physical order: restore inventory and any reserved internal value.
    v_inventory := public.restore_order_inventory(v_order.id)::JSONB;

    SELECT *
    INTO v_res
    FROM public.checkout_value_reservations
    WHERE order_id = v_order.id
    FOR UPDATE;

    IF FOUND AND v_res.status = 'consumed' THEN
      IF v_res.gift_card_id IS NOT NULL AND v_res.gift_card_amount > 0 THEN
        UPDATE public.gift_cards
        SET
          balance = LEAST(amount, COALESCE(balance, 0) + v_res.gift_card_amount),
          remaining_balance = LEAST(
            amount,
            COALESCE(remaining_balance, balance, 0) + v_res.gift_card_amount
          ),
          is_active = (
            expires_at IS NULL
            OR expires_at > NOW()
          )
        WHERE id = v_res.gift_card_id;
      END IF;

      IF v_res.credit_amount > 0 THEN
        SELECT balance
        INTO v_credit_before
        FROM public.user_credits
        WHERE user_id = v_res.user_id
        FOR UPDATE;

        v_credit_after := v_credit_before + v_res.credit_amount;

        UPDATE public.user_credits
        SET
          balance = v_credit_after,
          total_spent = GREATEST(0, total_spent - v_res.credit_amount),
          updated_at = NOW()
        WHERE user_id = v_res.user_id;

        INSERT INTO public.credit_transactions (
          user_id,
          amount,
          transaction_type,
          reference_id,
          reference_type,
          balance_before,
          balance_after,
          description
        )
        VALUES (
          v_res.user_id,
          v_res.credit_amount,
          'refund',
          v_order.id,
          'order',
          v_credit_before,
          v_credit_after,
          'Ripristino credito per rimborso ordine'
        )
        ON CONFLICT DO NOTHING;
      END IF;

      IF v_res.promotion_id IS NOT NULL THEN
        UPDATE public.promotions
        SET
          usage_count = GREATEST(0, usage_count - 1),
          updated_at = NOW()
        WHERE id = v_res.promotion_id;
      END IF;

      UPDATE public.checkout_value_reservations
      SET
        status = 'refunded',
        refunded_at = NOW(),
        updated_at = NOW()
      WHERE id = v_res.id;
    ELSE
      -- Compatibility for a pre-reservation order.
      IF COALESCE(v_order.gift_card_amount, 0) > 0
        AND v_order.gift_card_code IS NOT NULL
      THEN
        UPDATE public.gift_cards
        SET
          balance = LEAST(amount, COALESCE(balance, 0) + v_order.gift_card_amount),
          remaining_balance = LEAST(
            amount,
            COALESCE(remaining_balance, balance, 0) + v_order.gift_card_amount
          ),
          is_active = (expires_at IS NULL OR expires_at > NOW())
        WHERE REPLACE(UPPER(code), '-', '') =
          REPLACE(UPPER(v_order.gift_card_code), '-', '');
      END IF;

      IF COALESCE(v_order.user_credit_amount, 0) > 0 THEN
        SELECT balance
        INTO v_credit_before
        FROM public.user_credits
        WHERE user_id = v_order.user_id
        FOR UPDATE;

        v_credit_after := v_credit_before + v_order.user_credit_amount;

        UPDATE public.user_credits
        SET
          balance = v_credit_after,
          total_spent = GREATEST(0, total_spent - v_order.user_credit_amount),
          updated_at = NOW()
        WHERE user_id = v_order.user_id;

        INSERT INTO public.credit_transactions (
          user_id, amount, transaction_type, reference_id, reference_type,
          balance_before, balance_after, description
        )
        VALUES (
          v_order.user_id, v_order.user_credit_amount, 'refund', v_order.id, 'order',
          v_credit_before, v_credit_after, 'Ripristino credito ordine legacy rimborsato'
        )
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  UPDATE public.orders
  SET
    status = 'refunded',
    payment_status = 'refunded',
    updated_at = NOW()
  WHERE id = v_order.id;

  v_referral := public.revoke_referral_reward(v_order.id, 'stripe_full_refund');

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order.id,
    'inventory', v_inventory,
    'referral', v_referral
  );
END;
$$;

-- ============================================================
-- LEASE-BASED STRIPE EVENT CLAIMING
-- ============================================================

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_retry
  ON public.stripe_webhook_events(status, locked_until)
  WHERE status IN ('processing', 'failed');

CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_stripe_created TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claimed TEXT;
BEGIN
  IF NULLIF(TRIM(p_event_id), '') IS NULL
    OR NULLIF(TRIM(p_event_type), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid Stripe event'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stripe_webhook_events (
    event_id,
    event_type,
    stripe_created,
    status,
    attempts,
    locked_until,
    error,
    updated_at
  )
  VALUES (
    p_event_id,
    p_event_type,
    p_stripe_created,
    'processing',
    1,
    NOW() + INTERVAL '2 minutes',
    NULL,
    NOW()
  )
  ON CONFLICT (event_id) DO UPDATE
  SET
    event_type = EXCLUDED.event_type,
    stripe_created = COALESCE(
      public.stripe_webhook_events.stripe_created,
      EXCLUDED.stripe_created
    ),
    status = 'processing',
    attempts = public.stripe_webhook_events.attempts + 1,
    locked_until = NOW() + INTERVAL '2 minutes',
    error = NULL,
    updated_at = NOW()
  WHERE public.stripe_webhook_events.status = 'failed'
    OR (
      public.stripe_webhook_events.status = 'processing'
      AND COALESCE(public.stripe_webhook_events.locked_until, '-infinity') <= NOW()
    )
  RETURNING event_id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_stripe_webhook_event(
  p_event_id TEXT,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.stripe_webhook_events
  SET
    status = CASE WHEN p_success THEN 'processed' ELSE 'failed' END,
    error = CASE
      WHEN p_success THEN NULL
      ELSE LEFT(COALESCE(p_error, 'Unknown webhook error'), 1000)
    END,
    locked_until = NULL,
    processed_at = CASE WHEN p_success THEN NOW() ELSE NULL END,
    updated_at = NOW()
  WHERE event_id = p_event_id;
END;
$$;

-- ============================================================
-- PRESENCE WRITE BOUNDARY
-- Anonymous presence is useful for aggregate traffic, but clients must not be
-- able to forge another authenticated user or update arbitrary rows directly.
-- The high-entropy session ID acts as the anonymous row's bearer secret.
-- ============================================================

DROP POLICY IF EXISTS "Users can manage their presence" ON public.user_presence;
DROP POLICY IF EXISTS "presence_insert_any" ON public.user_presence;
DROP POLICY IF EXISTS "presence_update_any" ON public.user_presence;
DROP POLICY IF EXISTS "presence_select_admin_or_own" ON public.user_presence;
DROP POLICY IF EXISTS "presence_delete_admin" ON public.user_presence;
DROP POLICY IF EXISTS "presence_select_admin_or_own_v2" ON public.user_presence;
DROP POLICY IF EXISTS "presence_delete_admin_v2" ON public.user_presence;

CREATE POLICY "presence_select_admin_or_own_v2"
  ON public.user_presence
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin())
  );

CREATE POLICY "presence_delete_admin_v2"
  ON public.user_presence
  FOR DELETE
  TO authenticated
  USING ((SELECT public.is_admin()));

REVOKE INSERT, UPDATE ON public.user_presence FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_user_presence(
  p_session_id TEXT,
  p_user_id UUID DEFAULT NULL,
  p_page_url TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_is_authenticated BOOLEAN DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_authenticated_user UUID := auth.uid();
  v_existing_user UUID;
BEGIN
  IF p_session_id IS NULL
    OR p_session_id !~ '^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR char_length(COALESCE(p_page_url, '')) > 500
    OR (
      p_page_url IS NOT NULL
      AND p_page_url <> ''
      AND LEFT(p_page_url, 1) <> '/'
    )
    OR char_length(COALESCE(p_user_agent, '')) > 255
    OR (
      p_user_id IS NOT NULL
      AND p_user_id IS DISTINCT FROM v_authenticated_user
    )
    OR (
      COALESCE(p_is_authenticated, false)
      AND v_authenticated_user IS NULL
    )
  THEN
    RAISE EXCEPTION 'Invalid presence heartbeat'
      USING ERRCODE = '22023';
  END IF;

  SELECT user_id
  INTO v_existing_user
  FROM public.user_presence
  WHERE session_id = p_session_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_user IS NOT NULL
      AND v_existing_user IS DISTINCT FROM v_authenticated_user
    THEN
      RAISE EXCEPTION 'Presence session belongs to another user'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.user_presence
    SET
      user_id = COALESCE(v_authenticated_user, v_existing_user),
      page_url = NULLIF(p_page_url, ''),
      user_agent = NULLIF(p_user_agent, ''),
      is_authenticated = COALESCE(v_authenticated_user, v_existing_user) IS NOT NULL,
      last_seen = NOW()
    WHERE session_id = p_session_id;
  ELSE
    INSERT INTO public.user_presence (
      session_id,
      user_id,
      page_url,
      user_agent,
      is_authenticated,
      last_seen
    )
    VALUES (
      p_session_id,
      v_authenticated_user,
      NULLIF(p_page_url, ''),
      NULLIF(p_user_agent, ''),
      v_authenticated_user IS NOT NULL,
      NOW()
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_user_presence(
  TEXT, UUID, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_presence(
  TEXT, UUID, TEXT, TEXT, BOOLEAN
) TO anon, authenticated, service_role;

-- ============================================================
-- ADMIN ANALYTICS AND PRESENCE PRIVILEGES
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_total_revenue()
RETURNS DECIMAL
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total DECIMAL;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(total), 0)
  INTO v_total
  FROM public.orders
  WHERE payment_status = 'completed'
    AND status NOT IN ('cancelled', 'refunded');

  RETURN v_total;
END;
$$;

-- Restrict all existing overloads of privileged helpers. SECURITY DEFINER
-- ownership is not an authorization check by itself.
DO $$
DECLARE
  v_function RECORD;
BEGIN
  FOR v_function IN
    SELECT oid::regprocedure AS signature, proname
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'claim_stripe_webhook_event',
        'complete_stripe_webhook_event',
        'reserve_checkout_value',
        'bind_checkout_value_reservation',
        'extend_checkout_reservation_for_async_payment',
        'release_checkout_value_reservation',
        'release_checkout_value_reservation_by_session',
        'release_expired_checkout_reservations',
        'consume_checkout_value_reservation',
        'finalize_paid_order',
        'finalize_paid_gift_card',
        'refund_paid_order',
        'process_order_inventory',
        'restore_order_inventory',
        'redeem_order_gift_card',
        'deduct_order_user_credit',
        'process_referral_conversion',
        'revoke_referral_reward',
        'increment_promotion_usage',
        'count_ip_conversions_today',
        'create_audit_log'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_function.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      v_function.signature
    );
  END LOOP;
END $$;

-- This legacy non-payment helper still uses unqualified table names. Pin it to
-- the non-user-writable public schema; payment functions use an empty
-- search_path and fully qualify every object.
DO $$
DECLARE
  v_function RECORD;
BEGIN
  FOR v_function IN
    SELECT oid::regprocedure AS signature
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'count_ip_conversions_today'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public',
      v_function.signature
    );
  END LOOP;
END $$;

-- Admin dashboard functions remain callable by authenticated users, and each
-- authorizes the caller before reading aggregate or presence data.
CREATE OR REPLACE FUNCTION public.get_users_count()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count FROM auth.users;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_users_count()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(DISTINCT session_id)::INTEGER
  INTO v_count
  FROM public.user_presence
  WHERE last_seen > NOW() - INTERVAL '5 minutes';

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_users()
RETURNS TABLE (
  session_id TEXT,
  user_id UUID,
  last_seen TIMESTAMPTZ,
  page_url TEXT,
  is_authenticated BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (presence.session_id)
    presence.session_id,
    presence.user_id,
    presence.last_seen,
    presence.page_url,
    presence.is_authenticated
  FROM public.user_presence AS presence
  WHERE presence.last_seen > NOW() - INTERVAL '5 minutes'
  ORDER BY presence.session_id, presence.last_seen DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_new_users_count(period TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
  v_start TIMESTAMPTZ;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_start := CASE LOWER(COALESCE(period, 'today'))
    WHEN 'today' THEN DATE_TRUNC('day', NOW())
    WHEN 'week' THEN DATE_TRUNC('week', NOW())
    WHEN 'month' THEN DATE_TRUNC('month', NOW())
    ELSE DATE_TRUNC('day', NOW())
  END;

  SELECT COUNT(*)::INTEGER
  INTO v_count
  FROM auth.users
  WHERE created_at >= v_start;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_presence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_presence
  WHERE last_seen < NOW() - INTERVAL '1 hour';
END;
$$;

DO $$
DECLARE
  v_function RECORD;
BEGIN
  FOR v_function IN
    SELECT oid::regprocedure AS signature
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'get_users_count',
        'get_active_users_count',
        'get_active_users',
        'get_new_users_count',
        'get_total_revenue',
        'cleanup_old_presence'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',
      v_function.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
      v_function.signature
    );
  END LOOP;
END $$;

-- Direct audit/notification inserts are service operations. Service role
-- bypasses RLS; authenticated admins retain access through their admin policy.
REVOKE INSERT ON public.audit_log FROM anon, authenticated;
REVOKE INSERT ON public.notification_logs FROM anon;

-- Explicit grants for the payment runtime after the blanket revocations.
GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_stripe_webhook_event(TEXT, BOOLEAN, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_checkout_value(
  UUID, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, NUMERIC, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_checkout_value_reservation(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.extend_checkout_reservation_for_async_payment(
  TEXT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_checkout_value_reservation(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_checkout_value_reservation_by_session(TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_checkout_reservations(INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_checkout_value_reservation(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_paid_order(TEXT, TEXT, UUID, BIGINT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_paid_gift_card(TEXT, TEXT, UUID, BIGINT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_paid_order(TEXT)
  TO service_role;

COMMENT ON TABLE public.checkout_value_reservations IS
  'Atomic reservations for user credit, gift-card balance and limited promotions during Stripe Checkout';
COMMENT ON FUNCTION public.finalize_paid_order(TEXT, TEXT, UUID, BIGINT) IS
  'Atomically creates a paid order from its server-side checkout snapshot and consumes all side effects';
COMMENT ON FUNCTION public.claim_stripe_webhook_event(TEXT, TEXT, TIMESTAMPTZ) IS
  'Claims a Stripe event with a two-minute lease; concurrent deliveries cannot both process it';
