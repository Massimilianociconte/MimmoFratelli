-- Mimmo Fratelli E-commerce Platform
-- Migration 021: Security and payment hardening
-- Adds missing order metadata, fixes broken RPCs, and tightens risky RLS policies.

-- Orders created by Stripe functions currently write this field.
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS user_credit_amount DECIMAL(10,2) DEFAULT 0 CHECK (user_credit_amount >= 0);

COMMENT ON COLUMN orders.user_credit_amount IS 'User credit amount applied to the Stripe payment';

-- Gift-card Edge Functions already write `template`; keep schema aligned with runtime.
ALTER TABLE gift_cards
ADD COLUMN IF NOT EXISTS template TEXT DEFAULT 'elegant',
ADD COLUMN IF NOT EXISTS stripe_session_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_payment_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_cards_stripe_session_id
  ON gift_cards(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_cards_stripe_payment_id
  ON gift_cards(stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;

-- Helpful lookup for idempotency even if production already contains duplicate payment IDs.
CREATE INDEX IF NOT EXISTS idx_orders_payment_id
  ON orders(payment_id)
  WHERE payment_id IS NOT NULL;

-- Enforce one order per Stripe payment when existing data is clean.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT payment_id
      FROM orders
      WHERE payment_id IS NOT NULL
      GROUP BY payment_id
      HAVING COUNT(*) > 1
    ) duplicate_payment_ids
  ) THEN
    RAISE NOTICE 'Skipping unique index uq_orders_payment_id because duplicate payment_id values already exist';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_payment_id
      ON orders(payment_id)
      WHERE payment_id IS NOT NULL;
  END IF;
END $$;

-- Client-side order creation lets authenticated users forge paid-looking orders.
DROP POLICY IF EXISTS "Users can create own orders" ON orders;
DROP POLICY IF EXISTS "System can insert order items" ON order_items;

-- Broad SELECT leaked all gift card codes/tokens to any authenticated user.
DROP POLICY IF EXISTS "Authenticated users can validate gift cards" ON gift_cards;

-- Referral rewards and some legacy gift-card paths need explicit transaction types.
DO $$
DECLARE
  existing_constraint_name TEXT;
BEGIN
  SELECT conname INTO existing_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'credit_transactions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%transaction_type%'
  LIMIT 1;

  IF existing_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE credit_transactions DROP CONSTRAINT %I', existing_constraint_name);
  END IF;

  ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_transaction_type_check
  CHECK (transaction_type IN (
    'gift_card_redeem',
    'gift_card_redemption',
    'purchase',
    'refund',
    'admin_adjustment',
    'referral_reward',
    'referral_revoked'
  ));
END $$;

-- Increment promotion usage by the parameter name used by Edge Functions.
DROP FUNCTION IF EXISTS increment_promotion_usage(UUID);
DROP FUNCTION IF EXISTS increment_promotion_usage(TEXT);

CREATE OR REPLACE FUNCTION increment_promotion_usage(p_code TEXT)
RETURNS void AS $$
BEGIN
  UPDATE promotions
  SET usage_count = COALESCE(usage_count, 0) + 1,
      updated_at = NOW()
  WHERE code = UPPER(TRIM(p_code));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Minimal validation result for checkout/redeem pages without exposing the table via RLS.
CREATE OR REPLACE FUNCTION validate_gift_card_code(p_code TEXT)
RETURNS JSONB AS $$
DECLARE
  v_gift_card RECORD;
  v_available_balance DECIMAL(10,2);
  v_code TEXT;
BEGIN
  v_code := UPPER(TRIM(COALESCE(p_code, '')));

  SELECT * INTO v_gift_card
  FROM gift_cards
  WHERE code IN (REPLACE(v_code, '-', ''), v_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Codice non trovato o non valido');
  END IF;

  v_available_balance := GREATEST(
    0,
    LEAST(
      COALESCE(v_gift_card.remaining_balance, v_gift_card.balance, v_gift_card.amount),
      COALESCE(v_gift_card.balance, v_gift_card.amount),
      v_gift_card.amount
    )
  );

  IF NOT v_gift_card.is_active THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Gift card non attiva');
  END IF;

  IF COALESCE(v_gift_card.is_redeemed, false) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Gift card già riscattata');
  END IF;

  IF v_available_balance <= 0 THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Gift card esaurita');
  END IF;

  IF v_gift_card.expires_at IS NOT NULL AND v_gift_card.expires_at < NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Gift card scaduta');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'balance', v_available_balance,
    'giftCard', jsonb_build_object(
      'id', v_gift_card.id,
      'code', v_gift_card.code,
      'qr_code_token', v_gift_card.qr_code_token,
      'amount', v_gift_card.amount,
      'balance', v_available_balance,
      'remaining_balance', v_available_balance,
      'recipient_name', v_gift_card.recipient_name,
      'sender_name', v_gift_card.sender_name,
      'message', v_gift_card.message,
      'template', v_gift_card.template,
      'is_active', v_gift_card.is_active,
      'is_redeemed', v_gift_card.is_redeemed,
      'expires_at', v_gift_card.expires_at
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_gift_card_by_token(p_qr_token UUID)
RETURNS JSONB AS $$
DECLARE
  v_gift_card RECORD;
  v_available_balance DECIMAL(10,2);
BEGIN
  SELECT * INTO v_gift_card
  FROM gift_cards
  WHERE qr_code_token = p_qr_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Gift card non trovata');
  END IF;

  v_available_balance := GREATEST(
    0,
    LEAST(
      COALESCE(v_gift_card.remaining_balance, v_gift_card.balance, v_gift_card.amount),
      COALESCE(v_gift_card.balance, v_gift_card.amount),
      v_gift_card.amount
    )
  );

  RETURN jsonb_build_object(
    'giftCard', jsonb_build_object(
      'id', v_gift_card.id,
      'code', v_gift_card.code,
      'qr_code_token', v_gift_card.qr_code_token,
      'amount', v_gift_card.amount,
      'balance', v_available_balance,
      'remaining_balance', v_available_balance,
      'recipient_name', v_gift_card.recipient_name,
      'sender_name', v_gift_card.sender_name,
      'message', v_gift_card.message,
      'template', v_gift_card.template,
      'is_active', v_gift_card.is_active,
      'is_redeemed', v_gift_card.is_redeemed,
      'expires_at', v_gift_card.expires_at
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Remove broken overloads from migration 008 and make redemption derive the user from auth.uid().
DROP FUNCTION IF EXISTS redeem_gift_card(TEXT, UUID);
DROP FUNCTION IF EXISTS redeem_gift_card(UUID, UUID);

CREATE OR REPLACE FUNCTION redeem_gift_card(p_qr_token UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_gift_card RECORD;
  v_current_balance DECIMAL(10,2);
  v_new_balance DECIMAL(10,2);
  v_credit_amount DECIMAL(10,2);
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Devi effettuare il login per riscattare la gift card');
  END IF;

  SELECT * INTO v_gift_card
  FROM gift_cards
  WHERE qr_code_token = p_qr_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Gift card non trovata');
  END IF;

  IF COALESCE(v_gift_card.is_redeemed, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Questa gift card è già stata riscattata');
  END IF;

  IF NOT v_gift_card.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Gift card non attiva');
  END IF;

  IF v_gift_card.expires_at IS NOT NULL AND v_gift_card.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Gift card scaduta');
  END IF;

  v_credit_amount := GREATEST(
    0,
    LEAST(
      COALESCE(v_gift_card.remaining_balance, v_gift_card.balance, v_gift_card.amount),
      COALESCE(v_gift_card.balance, v_gift_card.amount),
      v_gift_card.amount
    )
  );

  IF v_credit_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Gift card esaurita');
  END IF;

  INSERT INTO user_credits (user_id, balance, total_earned)
  VALUES (v_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO v_current_balance
  FROM user_credits
  WHERE user_id = v_user_id
  FOR UPDATE;

  v_new_balance := v_current_balance + v_credit_amount;

  UPDATE user_credits
  SET balance = v_new_balance,
      total_earned = total_earned + v_credit_amount,
      updated_at = NOW()
  WHERE user_id = v_user_id;

  UPDATE gift_cards
  SET is_redeemed = TRUE,
      redeemed_by = v_user_id,
      redeemed_at = NOW(),
      balance = 0,
      remaining_balance = 0,
      is_active = FALSE
  WHERE id = v_gift_card.id;

  INSERT INTO credit_transactions (
    user_id, amount, transaction_type,
    reference_id, reference_type,
    balance_before, balance_after, description
  ) VALUES (
    v_user_id, v_credit_amount, 'gift_card_redeem',
    v_gift_card.id, 'gift_card',
    v_current_balance, v_new_balance,
    'Riscatto gift card ' || v_gift_card.code
  );

  RETURN jsonb_build_object(
    'success', true,
    'amount', v_credit_amount,
    'new_balance', v_new_balance,
    'gift_card_code', v_gift_card.code
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP FUNCTION IF EXISTS use_credits(UUID, DECIMAL, UUID);

CREATE OR REPLACE FUNCTION use_credits(p_user_id UUID, p_amount DECIMAL, p_order_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_current_balance DECIMAL(10,2);
  v_new_balance DECIMAL(10,2);
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operazione non autorizzata');
  END IF;

  SELECT balance INTO v_current_balance
  FROM user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nessun credito disponibile');
  END IF;

  IF v_current_balance < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Credito insufficiente',
      'available', v_current_balance,
      'requested', p_amount
    );
  END IF;

  v_new_balance := v_current_balance - p_amount;

  UPDATE user_credits
  SET balance = v_new_balance,
      total_spent = total_spent + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO credit_transactions (
    user_id, amount, transaction_type,
    reference_id, reference_type,
    balance_before, balance_after, description
  ) VALUES (
    p_user_id, -p_amount, 'purchase',
    p_order_id, 'order',
    v_current_balance, v_new_balance,
    'Utilizzo credito per ordine'
  );

  RETURN jsonb_build_object(
    'success', true,
    'amount_used', p_amount,
    'new_balance', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
