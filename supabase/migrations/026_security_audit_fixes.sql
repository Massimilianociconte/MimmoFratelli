-- Mimmo Fratelli E-commerce Platform
-- Migration 026: Security & integrity audit fixes
-- Chiude le falle emerse dall'audit completo del database:
--   1) bypass anon in use_credits
--   2) RLS permissiva su user_presence (PII leggibile/scrivibile da chiunque)
--   3) revoca esecuzione anonima su redeem_gift_card (difesa in profondita')
--   4) get_total_revenue rotta (colonna inesistente total_amount)
--   5) hardening search_path su funzioni SECURITY DEFINER
--   6) idempotenza credit_transactions
--   7) vincolo mancante orders.gift_card_amount >= 0
--   8) generate_order_number: riduce rischio collisione
-- Tutte le operazioni sono idempotenti/guardate per un'applicazione sicura in produzione.

-- ============================================================
-- 1) CRITICO: use_credits - bypass anon (auth.uid() IS NULL)
--    Con la chiave anon auth.uid() e' NULL: la vecchia guardia
--    "IS NOT NULL AND <> p_user_id" veniva saltata, permettendo di
--    spendere il credito di qualunque utente. La detrazione ordini
--    passa da deduct_order_user_credit (service role), non da qui.
-- ============================================================
CREATE OR REPLACE FUNCTION use_credits(p_user_id UUID, p_amount DECIMAL, p_order_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_current_balance DECIMAL(10,2);
  v_new_balance DECIMAL(10,2);
BEGIN
  -- Solo il proprietario autenticato puo' spendere il proprio credito.
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
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

REVOKE EXECUTE ON FUNCTION use_credits(UUID, DECIMAL, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION use_credits(UUID, DECIMAL, UUID) TO authenticated, service_role;

-- ============================================================
-- 2) CRITICO: RLS user_presence
--    La policy "FOR ALL USING(true) WITH CHECK(true)" esponeva
--    pagina/user-agent/user_id di chiunque online e consentiva
--    modifica/cancellazione altrui. Il tracking usa upsert su
--    session_id con return=minimal (nessun SELECT necessario),
--    quindi possiamo restringere lettura e cancellazione.
-- ============================================================
DROP POLICY IF EXISTS "Users can manage their presence" ON user_presence;
DROP POLICY IF EXISTS "presence_insert_any" ON user_presence;
DROP POLICY IF EXISTS "presence_update_any" ON user_presence;
DROP POLICY IF EXISTS "presence_select_admin_or_own" ON user_presence;
DROP POLICY IF EXISTS "presence_delete_admin" ON user_presence;

-- INSERT: necessario per il tracking anonimo/autenticato (heartbeat)
CREATE POLICY "presence_insert_any" ON user_presence
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- UPDATE: l'upsert (ON CONFLICT session_id) aggiorna last_seen/page_url
CREATE POLICY "presence_update_any" ON user_presence
  FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);

-- SELECT: solo admin o il proprio record (niente enumerazione pubblica)
CREATE POLICY "presence_select_admin_or_own" ON user_presence
  FOR SELECT
  USING (is_admin() OR auth.uid() = user_id);

-- DELETE: solo admin (la pulizia periodica usa cleanup_old_presence SECURITY DEFINER)
CREATE POLICY "presence_delete_admin" ON user_presence
  FOR DELETE
  USING (is_admin());

-- ============================================================
-- 3) CRITICO: redeem_gift_card - nessuna esecuzione anonima
--    La funzione blocca gia' auth.uid() IS NULL internamente;
--    qui rimuoviamo comunque il grant di default a PUBLIC/anon.
--    validate_gift_card_code e get_gift_card_by_token restano
--    accessibili (servono a guest checkout / preview riscatto).
--    Dinamico: la firma effettiva in produzione puo' variare
--    (overload storici), quindi applichiamo a ogni redeem_gift_card
--    realmente presente in public. Nessun errore se assente.
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'redeem_gift_card'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- ============================================================
-- 4) get_total_revenue: la colonna e' "total", non "total_amount"
-- ============================================================
CREATE OR REPLACE FUNCTION get_total_revenue()
RETURNS DECIMAL AS $$
DECLARE
  v_total DECIMAL;
BEGIN
  SELECT COALESCE(SUM(total), 0) INTO v_total
  FROM orders
  WHERE status NOT IN ('cancelled', 'refunded');
  RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 5) Hardening search_path su funzioni SECURITY DEFINER esistenti
--    (previene search_path hijacking). Dinamico: applica a ogni
--    overload realmente presente in public, cosi' eventuali
--    differenze di firma tra migration e produzione non bloccano.
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (
        'is_admin', 'get_users_count', 'get_active_users_count', 'get_active_users',
        'update_user_presence', 'get_new_users_count', 'cleanup_old_presence',
        'has_stock_alert', 'handle_new_user'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END $$;

-- ============================================================
-- 6) Idempotenza credit_transactions
--    Impedisce a livello DB un doppio movimento con stessa
--    (reference_type, reference_id, transaction_type). Guardato:
--    non fallisce se esistono gia' duplicati storici.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT reference_type, reference_id, transaction_type
      FROM credit_transactions
      WHERE reference_id IS NOT NULL
      GROUP BY reference_type, reference_id, transaction_type
      HAVING COUNT(*) > 1
    ) duplicate_refs
  ) THEN
    RAISE NOTICE 'Skipping uq_credit_tx_reference: duplicate reference rows already exist';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_tx_reference
      ON credit_transactions(reference_type, reference_id, transaction_type)
      WHERE reference_id IS NOT NULL;
  END IF;
END $$;

-- ============================================================
-- 7) Vincolo mancante: orders.gift_card_amount >= 0
--    (le altre colonne importo hanno gia' il CHECK)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name = 'gift_card_amount'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_gift_card_amount_check'
  ) AND NOT EXISTS (
    SELECT 1 FROM orders WHERE gift_card_amount < 0
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_gift_card_amount_check CHECK (gift_card_amount >= 0);
  END IF;
END $$;

-- ============================================================
-- 8) generate_order_number: 4 -> 6 cifre casuali per ridurre le
--    collisioni. UNIQUE(order_number) resta la garanzia finale.
-- ============================================================
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.order_number := 'AVM-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
    LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
