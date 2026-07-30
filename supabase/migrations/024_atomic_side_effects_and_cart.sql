-- Mimmo Fratelli E-commerce Platform
-- Migration 024: Operazioni atomiche post-pagamento e carrello
-- 1) Riscatto gift card e detrazione crediti in modo transazionale e idempotente
--    (stesso pattern di process_order_inventory: lock ordine + flag)
-- 2) Fix vincolo unicità cart_items con weight_grams NULL (i NULL non confliggono)
-- 3) RPC add_to_cart_item per upsert atomico del carrello (elimina TOCTOU client)

-- ============================================
-- FLAG DI IDEMPOTENZA SU ORDERS
-- ============================================
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS gift_card_redeemed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS user_credit_deducted BOOLEAN NOT NULL DEFAULT false;

-- Gli ordini già processati dal vecchio flusso non devono essere ri-processati
UPDATE orders
SET gift_card_redeemed = true, user_credit_deducted = true
WHERE payment_status = 'completed';

-- ============================================
-- FUNCTION: Riscatta la gift card usata in un ordine
-- Idempotente: lock FOR UPDATE su ordine + flag; lock FOR UPDATE su gift card
-- previene il double-spend da webhook + fallback concorrenti
-- ============================================
CREATE OR REPLACE FUNCTION redeem_order_gift_card(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_order RECORD;
  v_gc RECORD;
  v_current NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  SELECT id, gift_card_code, gift_card_amount, gift_card_redeemed INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Ordine non trovato');
  END IF;

  IF v_order.gift_card_redeemed THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  IF v_order.gift_card_code IS NULL OR COALESCE(v_order.gift_card_amount, 0) <= 0 THEN
    UPDATE orders SET gift_card_redeemed = true, updated_at = NOW() WHERE id = p_order_id;
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  SELECT id, amount, balance, remaining_balance INTO v_gc
  FROM gift_cards
  WHERE code = upper(replace(v_order.gift_card_code, '-', ''))
  FOR UPDATE;

  IF v_gc.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Gift card non trovata: ' || v_order.gift_card_code);
  END IF;

  -- Saldo corrente: il minimo tra i campi legacy per sicurezza
  v_current := LEAST(
    COALESCE(v_gc.remaining_balance, v_gc.balance, v_gc.amount),
    COALESCE(v_gc.balance, v_gc.amount),
    v_gc.amount
  );
  v_new_balance := GREATEST(0, v_current - v_order.gift_card_amount);

  UPDATE gift_cards
  SET balance = v_new_balance,
      remaining_balance = v_new_balance,
      is_active = v_new_balance > 0
  WHERE id = v_gc.id;

  UPDATE orders SET gift_card_redeemed = true, updated_at = NOW() WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================
-- FUNCTION: Detrae il credito utente usato in un ordine
-- Idempotente: lock FOR UPDATE su ordine + flag; lock FOR UPDATE su user_credits
-- ============================================
CREATE OR REPLACE FUNCTION deduct_order_user_credit(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_order RECORD;
  v_credit RECORD;
  v_new_balance NUMERIC;
BEGIN
  SELECT id, user_id, order_number, user_credit_amount, user_credit_deducted INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Ordine non trovato');
  END IF;

  IF v_order.user_credit_deducted THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  IF COALESCE(v_order.user_credit_amount, 0) <= 0 THEN
    UPDATE orders SET user_credit_deducted = true, updated_at = NOW() WHERE id = p_order_id;
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  SELECT id, balance INTO v_credit
  FROM user_credits
  WHERE user_id = v_order.user_id
  FOR UPDATE;

  IF v_credit.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Credito utente non trovato');
  END IF;

  v_new_balance := GREATEST(0, v_credit.balance - v_order.user_credit_amount);

  UPDATE user_credits SET balance = v_new_balance WHERE id = v_credit.id;

  INSERT INTO credit_transactions (
    user_id, amount, transaction_type, reference_id, reference_type,
    balance_before, balance_after, description
  ) VALUES (
    v_order.user_id, -v_order.user_credit_amount, 'purchase', p_order_id, 'order',
    v_credit.balance, v_new_balance, 'Pagamento ordine #' || v_order.order_number
  );

  UPDATE orders SET user_credit_deducted = true, updated_at = NOW() WHERE id = p_order_id;

  RETURN json_build_object('success', true, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Solo service role (edge functions): nessuna esecuzione da client pubblici
REVOKE EXECUTE ON FUNCTION redeem_order_gift_card(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION deduct_order_user_credit(UUID) FROM PUBLIC, anon, authenticated;

-- ============================================
-- CART: dedup + indice unico che gestisce weight_grams NULL
-- Il vincolo UNIQUE(...weight_grams) non blocca i duplicati con NULL
-- ============================================

-- Rimuove eventuali duplicati esistenti (mantiene la riga più recente)
DELETE FROM cart_items a
USING cart_items b
WHERE a.created_at < b.created_at
  AND a.user_id = b.user_id
  AND a.product_id = b.product_id
  AND a.size = b.size
  AND a.color = b.color
  AND COALESCE(a.weight_grams, -1) = COALESCE(b.weight_grams, -1);

CREATE UNIQUE INDEX IF NOT EXISTS cart_items_unique_item_norm
ON cart_items (user_id, product_id, size, color, COALESCE(weight_grams, -1));

-- Il vecchio vincolo è superato dall'indice normalizzato (e non copriva i NULL)
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_unique_item;

-- ============================================
-- FUNCTION: Upsert atomico nel carrello (elimina il TOCTOU lato client)
-- Legata a auth.uid(): un utente può modificare solo il proprio carrello
-- ============================================
CREATE OR REPLACE FUNCTION add_to_cart_item(
  p_product_id UUID,
  p_size TEXT,
  p_color TEXT,
  p_quantity INTEGER,
  p_weight_grams INTEGER DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_user UUID := auth.uid();
  v_qty INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Non autenticato');
  END IF;

  IF p_quantity IS NULL OR p_quantity < 1 THEN
    p_quantity := 1;
  END IF;

  INSERT INTO cart_items (user_id, product_id, size, color, quantity, weight_grams)
  VALUES (
    v_user,
    p_product_id,
    COALESCE(p_size, ''),
    COALESCE(p_color, 'Fresco'),
    LEAST(10, p_quantity),
    p_weight_grams
  )
  ON CONFLICT (user_id, product_id, size, color, COALESCE(weight_grams, -1))
  DO UPDATE SET
    quantity = LEAST(10, cart_items.quantity + LEAST(10, p_quantity)),
    updated_at = NOW()
  RETURNING quantity INTO v_qty;

  RETURN json_build_object('success', true, 'quantity', v_qty);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION add_to_cart_item(UUID, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION add_to_cart_item(UUID, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION redeem_order_gift_card(UUID) IS 'Riscatta la gift card di un ordine (idempotente, lock FOR UPDATE, previene double-spend)';
COMMENT ON FUNCTION deduct_order_user_credit(UUID) IS 'Detrae il credito utente di un ordine (idempotente, lock FOR UPDATE, registra la transazione)';
COMMENT ON FUNCTION add_to_cart_item(UUID, TEXT, TEXT, INTEGER, INTEGER) IS 'Upsert atomico di un articolo nel carrello dell''utente autenticato (max 10 pezzi)';
COMMENT ON COLUMN orders.gift_card_redeemed IS 'True se il saldo della gift card è già stato scalato per questo ordine';
COMMENT ON COLUMN orders.user_credit_deducted IS 'True se il credito utente è già stato detratto per questo ordine';
