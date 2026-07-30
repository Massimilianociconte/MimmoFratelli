\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.assert_true(p_condition BOOLEAN, p_message TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(p_condition, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'assertion failed: %', p_message;
  END IF;
END;
$$;

DO $$
DECLARE
  v_expected_tables INTEGER := 13;
  v_rls_tables INTEGER;
  v_unhardened_functions INTEGER;
  v_public_security_definers INTEGER;
  v_missing_fk_indexes INTEGER;
  v_duplicate_indexes INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_rls_tables
  FROM pg_class
  WHERE oid IN (
    'public.orders'::regclass,
    'public.order_items'::regclass,
    'public.pending_checkout_sessions'::regclass,
    'public.checkout_value_reservations'::regclass,
    'public.stripe_webhook_events'::regclass,
    'public.gift_cards'::regclass,
    'public.user_credits'::regclass,
    'public.credit_transactions'::regclass,
    'public.promotions'::regclass,
    'public.referrals'::regclass,
    'public.user_referral_codes'::regclass,
    'public.audit_log'::regclass,
    'public.stock_alerts'::regclass
  )
    AND relrowsecurity;

  PERFORM pg_temp.assert_true(
    v_rls_tables = v_expected_tables,
    'every payment-sensitive table must have RLS enabled'
  );

  PERFORM pg_temp.assert_true(
    NOT has_function_privilege(
      'anon',
      'public.reserve_checkout_value(uuid,text,numeric,text,numeric,text,numeric,jsonb)',
      'EXECUTE'
    ),
    'anon must not reserve internal checkout value'
  );
  PERFORM pg_temp.assert_true(
    NOT has_function_privilege(
      'authenticated',
      'public.finalize_paid_order(text,text,uuid,bigint)',
      'EXECUTE'
    ),
    'authenticated clients must not finalize paid orders'
  );
  PERFORM pg_temp.assert_true(
    NOT has_function_privilege(
      'anon',
      'public.claim_stripe_webhook_event(text,text,timestamp with time zone)',
      'EXECUTE'
    ),
    'anon must not claim Stripe events'
  );
  PERFORM pg_temp.assert_true(
    NOT has_function_privilege(
      'authenticated',
      'public.refund_paid_order(text)',
      'EXECUTE'
    ),
    'authenticated clients must not issue internal refunds'
  );
  PERFORM pg_temp.assert_true(
    has_function_privilege(
      'service_role',
      'public.finalize_paid_order(text,text,uuid,bigint)',
      'EXECUTE'
    ),
    'service role must be able to finalize paid orders'
  );
  PERFORM pg_temp.assert_true(
    has_function_privilege(
      'anon',
      'public.validate_gift_card_code(text)',
      'EXECUTE'
    ),
    'minimal gift-card validation must remain callable'
  );
  PERFORM pg_temp.assert_true(
    NOT has_function_privilege(
      'anon',
      'public.is_gift_card_code_available(text)',
      'EXECUTE'
    ),
    'legacy gift-card availability must be service-only'
  );
  PERFORM pg_temp.assert_true(
    has_function_privilege(
      'authenticated',
      'public.has_stock_alert(uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.has_stock_alert(uuid)',
      'EXECUTE'
    ),
    'stock-alert lookup must require authentication'
  );

  PERFORM pg_temp.assert_true(
    NOT has_table_privilege(
      'anon',
      'public.user_credits',
      'SELECT,INSERT,UPDATE,DELETE'
    ),
    'anon must have no direct user-credit privileges'
  );
  PERFORM pg_temp.assert_true(
    NOT has_table_privilege(
      'authenticated',
      'public.stripe_webhook_events',
      'INSERT,UPDATE,DELETE'
    ),
    'authenticated clients must not mutate the Stripe event ledger'
  );
  PERFORM pg_temp.assert_true(
    NOT has_table_privilege(
      'authenticated',
      'public.checkout_value_reservations',
      'INSERT,UPDATE,DELETE'
    ),
    'authenticated clients must not mutate checkout reservations'
  );

  SELECT COUNT(*)
  INTO v_unhardened_functions
  FROM pg_proc
  WHERE oid IN (
    'public.reserve_checkout_value(uuid,text,numeric,text,numeric,text,numeric,jsonb)'::regprocedure,
    'public.bind_checkout_value_reservation(uuid,text)'::regprocedure,
    'public.consume_checkout_value_reservation(uuid,text)'::regprocedure,
    'public.finalize_paid_order(text,text,uuid,bigint)'::regprocedure,
    'public.finalize_paid_gift_card(text,text,uuid,bigint)'::regprocedure,
    'public.refund_paid_order(text)'::regprocedure,
    'public.claim_stripe_webhook_event(text,text,timestamp with time zone)'::regprocedure
  )
    AND (
      NOT prosecdef
      OR proconfig IS NULL
      OR NOT ('search_path=""' = ANY(proconfig))
    );

  PERFORM pg_temp.assert_true(
    v_unhardened_functions = 0,
    'sensitive SECURITY DEFINER functions must pin an empty search_path'
  );

  SELECT COUNT(*)
  INTO v_public_security_definers
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND prosecdef
    AND has_function_privilege('public', oid, 'EXECUTE');

  PERFORM pg_temp.assert_true(
    v_public_security_definers = 0,
    'no public-schema SECURITY DEFINER function may retain PUBLIC execution'
  );

  SELECT COUNT(*)
  INTO v_unhardened_functions
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND prosecdef
    AND (
      proconfig IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(proconfig) AS config_entry
        WHERE config_entry LIKE 'search_path=%'
      )
    );

  PERFORM pg_temp.assert_true(
    v_unhardened_functions = 0,
    'every SECURITY DEFINER function must set search_path explicitly'
  );

  WITH foreign_keys AS (
    SELECT conrelid, conkey
    FROM pg_constraint
    WHERE contype = 'f'
      AND connamespace = 'public'::regnamespace
  )
  SELECT COUNT(*)
  INTO v_missing_fk_indexes
  FROM foreign_keys
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_definition
    WHERE index_definition.indrelid = foreign_keys.conrelid
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND (
        SELECT array_agg(column_number ORDER BY ordinal_position)
        FROM unnest(index_definition.indkey::SMALLINT[])
          WITH ORDINALITY AS indexed_columns(
            column_number,
            ordinal_position
          )
        WHERE ordinal_position <= cardinality(foreign_keys.conkey)
      ) @> foreign_keys.conkey
      AND (
        SELECT array_agg(column_number ORDER BY ordinal_position)
        FROM unnest(index_definition.indkey::SMALLINT[])
          WITH ORDINALITY AS indexed_columns(
            column_number,
            ordinal_position
          )
        WHERE ordinal_position <= cardinality(foreign_keys.conkey)
      ) <@ foreign_keys.conkey
  );

  PERFORM pg_temp.assert_true(
    v_missing_fk_indexes = 0,
    'every public-schema foreign key must have a supporting index'
  );

  WITH indexes AS (
    SELECT
      index_definition.indrelid,
      index_definition.indkey::TEXT AS keys,
      index_definition.indclass::TEXT AS classes,
      index_definition.indcollation::TEXT AS collations,
      index_definition.indoption::TEXT AS options,
      COALESCE(
        pg_get_expr(
          index_definition.indexprs,
          index_definition.indrelid
        ),
        ''
      ) AS expressions,
      COALESCE(
        pg_get_expr(
          index_definition.indpred,
          index_definition.indrelid
        ),
        ''
      ) AS predicate
    FROM pg_index AS index_definition
    JOIN pg_class AS table_definition
      ON table_definition.oid = index_definition.indrelid
    WHERE table_definition.relnamespace = 'public'::regnamespace
  ),
  duplicate_groups AS (
    SELECT 1
    FROM indexes
    GROUP BY
      indrelid,
      keys,
      classes,
      collations,
      options,
      expressions,
      predicate
    HAVING COUNT(*) > 1
  )
  SELECT COUNT(*)
  INTO v_duplicate_indexes
  FROM duplicate_groups;

  PERFORM pg_temp.assert_true(
    v_duplicate_indexes = 0,
    'equivalent indexes must not duplicate write work'
  );

  PERFORM pg_temp.assert_true(
    to_regprocedure('public.create_audit_log(uuid,text,jsonb)') IS NULL,
    'the broken audit-log overload must be removed'
  );
  PERFORM pg_temp.assert_true(
    to_regprocedure(
      'public.create_audit_log(uuid,text,text,uuid,jsonb,jsonb)'
    ) IS NOT NULL,
    'the valid audit-log function must remain available'
  );
END;
$$;

-- These constraints are intentionally installed NOT VALID in production so
-- legacy rows do not block rollout. A fresh database must validate cleanly.
ALTER TABLE public.user_credits
  VALIDATE CONSTRAINT user_credits_totals_nonnegative;
ALTER TABLE public.gift_cards
  VALIDATE CONSTRAINT gift_cards_remaining_balance_range;
ALTER TABLE public.promotions
  VALIDATE CONSTRAINT promotions_value_range;
ALTER TABLE public.referrals
  VALIDATE CONSTRAINT referrals_reward_positive;
ALTER TABLE public.pending_checkout_sessions
  VALIDATE CONSTRAINT pending_checkout_amounts_reconcile;

DO $$
DECLARE
  v_user UUID := '00000000-0000-4000-8000-000000000001';
  v_product UUID := '10000000-0000-4000-8000-000000000001';
  v_items JSONB;
  v_result JSONB;
  v_reservation_id UUID;
  v_order_id UUID;
  v_numeric NUMERIC;
  v_integer INTEGER;
  v_text TEXT;
BEGIN
  INSERT INTO auth.users (
    id,
    aud,
    role,
    email,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES (
    v_user,
    'authenticated',
    'authenticated',
    'payment-integrity-test@example.invalid',
    '{}'::JSONB,
    '{"first_name":"Payment","last_name":"Integrity"}'::JSONB,
    NOW(),
    NOW()
  );

  INSERT INTO public.products (
    id,
    name,
    slug,
    price,
    inventory,
    num_items,
    unit_measure,
    is_active
  )
  VALUES (
    v_product,
    'Prodotto test pagamenti',
    'prodotto-test-pagamenti',
    20,
    2,
    2,
    'pz',
    true
  );

  INSERT INTO public.user_credits (
    user_id,
    balance,
    total_earned,
    total_spent
  )
  VALUES (v_user, 10, 10, 0);

  INSERT INTO public.gift_cards (
    code,
    amount,
    balance,
    remaining_balance,
    recipient_name,
    is_active,
    is_redeemed,
    expires_at
  )
  VALUES (
    'TEST-GIFT-0001',
    20,
    20,
    20,
    'Test',
    true,
    false,
    NOW() + INTERVAL '1 year'
  );

  INSERT INTO public.promotions (
    name,
    discount_type,
    discount_value,
    min_purchase,
    code,
    usage_limit,
    usage_count,
    starts_at,
    ends_at,
    is_active
  )
  VALUES (
    'Promozione test pagamenti',
    'fixed',
    1,
    0,
    'PROMO-TEST',
    1,
    0,
    NOW() - INTERVAL '1 day',
    NOW() + INTERVAL '1 day',
    true
  );

  BEGIN
    UPDATE public.user_credits
    SET total_spent = -1
    WHERE user_id = v_user;
    RAISE EXCEPTION 'negative total_spent was accepted';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  BEGIN
    PERFORM public.use_credits(v_user, -1, NULL);
    RAISE EXCEPTION 'negative direct credit spend was accepted';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      NULL;
  END;

  BEGIN
    PERFORM public.use_credits(
      v_user,
      1,
      '20000000-0000-4000-8000-000000000001'::UUID
    );
    RAISE EXCEPTION 'legacy direct credit spending was accepted';
  EXCEPTION
    WHEN SQLSTATE '0A000' THEN
      NULL;
  END;

  v_items := jsonb_build_array(
    jsonb_build_object(
      'product_id', v_product,
      'product_name', 'Prodotto test pagamenti',
      'product_price', 20,
      'quantity', 1,
      'size', 'Standard',
      'color', 'Fresco'
    )
  );

  v_result := public.reserve_checkout_value(
    v_user,
    'payment-integrity-key-00000001',
    3,
    'TEST-GIFT-0001',
    4,
    'PROMO-TEST',
    20,
    v_items
  );
  v_reservation_id := (v_result->>'reservation_id')::UUID;

  PERFORM pg_temp.assert_true(
    COALESCE((v_result->>'success')::BOOLEAN, false),
    'first reservation must succeed'
  );
  PERFORM pg_temp.assert_true(
    COALESCE((v_result->>'reused')::BOOLEAN, true) IS FALSE,
    'first reservation must not be marked reused'
  );

  SELECT balance INTO v_numeric
  FROM public.user_credits
  WHERE user_id = v_user;
  PERFORM pg_temp.assert_true(v_numeric = 7, 'credit balance must be reserved');

  SELECT balance INTO v_numeric
  FROM public.gift_cards
  WHERE code = 'TEST-GIFT-0001';
  PERFORM pg_temp.assert_true(v_numeric = 16, 'gift-card balance must be reserved');

  v_result := public.reserve_checkout_value(
    v_user,
    'payment-integrity-key-00000001',
    3,
    'TEST-GIFT-0001',
    4,
    'PROMO-TEST',
    20,
    v_items
  );
  PERFORM pg_temp.assert_true(
    COALESCE((v_result->>'reused')::BOOLEAN, false),
    'same idempotency key and payload must be reused'
  );

  SELECT balance INTO v_numeric
  FROM public.user_credits
  WHERE user_id = v_user;
  PERFORM pg_temp.assert_true(
    v_numeric = 7,
    'idempotent retry must not reserve credit twice'
  );

  BEGIN
    PERFORM public.reserve_checkout_value(
      v_user,
      'payment-integrity-key-00000001',
      2,
      'TEST-GIFT-0001',
      4,
      'PROMO-TEST',
      20,
      v_items
    );
    RAISE EXCEPTION 'idempotency key accepted a changed amount';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      NULL;
  END;

  BEGIN
    PERFORM public.reserve_checkout_value(
      v_user,
      'payment-integrity-key-00000002',
      0,
      NULL,
      0,
      'PROMO-TEST',
      20,
      v_items
    );
    RAISE EXCEPTION 'limited promotion was reserved twice';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  BEGIN
    PERFORM public.reserve_checkout_value(
      v_user,
      'payment-integrity-key-00000003',
      0,
      NULL,
      0,
      NULL,
      40,
      jsonb_set(v_items, '{0,quantity}', '2'::JSONB)
    );
    RAISE EXCEPTION 'inventory overbooking was accepted';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  PERFORM public.bind_checkout_value_reservation(
    v_reservation_id,
    'cs_test_release_0001'
  );
  PERFORM public.extend_checkout_reservation_for_async_payment(
    'cs_test_release_0001',
    30
  );

  SELECT EXTRACT(EPOCH FROM (expires_at - created_at))::INTEGER
  INTO v_integer
  FROM public.checkout_value_reservations
  WHERE id = v_reservation_id;
  PERFORM pg_temp.assert_true(
    v_integer >= 3599,
    'async reservation extension must enforce the one-hour minimum'
  );

  v_result := public.release_checkout_value_reservation_by_session(
    'cs_test_release_0001',
    'test_release'
  );
  PERFORM pg_temp.assert_true(
    v_result->>'status' = 'released',
    'reservation release must succeed'
  );

  SELECT balance INTO v_numeric
  FROM public.user_credits
  WHERE user_id = v_user;
  PERFORM pg_temp.assert_true(v_numeric = 10, 'release must restore user credit');

  SELECT balance INTO v_numeric
  FROM public.gift_cards
  WHERE code = 'TEST-GIFT-0001';
  PERFORM pg_temp.assert_true(v_numeric = 20, 'release must restore gift-card value');

  PERFORM public.release_checkout_value_reservation(
    v_reservation_id,
    'duplicate_release'
  );
  SELECT balance INTO v_numeric
  FROM public.user_credits
  WHERE user_id = v_user;
  PERFORM pg_temp.assert_true(
    v_numeric = 10,
    'duplicate release must not restore credit twice'
  );

  v_result := public.reserve_checkout_value(
    v_user,
    'payment-integrity-key-00000001',
    3,
    'TEST-GIFT-0001',
    4,
    'PROMO-TEST',
    20,
    v_items
  );
  v_reservation_id := (v_result->>'reservation_id')::UUID;
  PERFORM public.bind_checkout_value_reservation(
    v_reservation_id,
    'cs_test_finalize_0001'
  );

  INSERT INTO public.pending_checkout_sessions (
    stripe_session_id,
    user_id,
    checkout_type,
    status,
    customer_email,
    items,
    shipping_address,
    subtotal,
    discount_amount,
    gift_card_amount,
    user_credit_amount,
    shipping_cost,
    total,
    promotion_code,
    gift_card_code
  )
  VALUES (
    'cs_test_finalize_0001',
    v_user,
    'order',
    'created',
    'payment-integrity-test@example.invalid',
    v_items,
    '{"line1":"Test","city":"Test","postal_code":"00000","country":"IT"}'::JSONB,
    20,
    0,
    4,
    3,
    0,
    13,
    'PROMO-TEST',
    'TEST-GIFT-0001'
  );

  v_result := public.finalize_paid_order(
    'cs_test_finalize_0001',
    'pi_test_finalize_0001',
    v_user,
    1300
  );
  v_order_id := (v_result->>'order_id')::UUID;
  PERFORM pg_temp.assert_true(
    COALESCE((v_result->>'success')::BOOLEAN, false),
    'paid order finalization must succeed'
  );
  PERFORM pg_temp.assert_true(
    COALESCE((v_result->>'created')::BOOLEAN, false),
    'first paid order finalization must create the order'
  );

  SELECT num_items INTO v_integer
  FROM public.products
  WHERE id = v_product;
  PERFORM pg_temp.assert_true(v_integer = 1, 'finalization must decrement inventory');

  SELECT usage_count INTO v_integer
  FROM public.promotions
  WHERE code = 'PROMO-TEST';
  PERFORM pg_temp.assert_true(v_integer = 1, 'finalization must consume promotion once');

  SELECT status INTO v_text
  FROM public.checkout_value_reservations
  WHERE id = v_reservation_id;
  PERFORM pg_temp.assert_true(v_text = 'consumed', 'reservation must be consumed');

  SELECT status INTO v_text
  FROM public.pending_checkout_sessions
  WHERE stripe_session_id = 'cs_test_finalize_0001';
  PERFORM pg_temp.assert_true(v_text = 'completed', 'pending checkout must complete');

  SELECT COUNT(*) INTO v_integer
  FROM public.order_items
  WHERE order_id = v_order_id;
  PERFORM pg_temp.assert_true(v_integer = 1, 'exactly one order item must be created');

  v_result := public.finalize_paid_order(
    'cs_test_finalize_0001',
    'pi_test_finalize_0001',
    v_user,
    1300
  );
  PERFORM pg_temp.assert_true(
    COALESCE((v_result->>'created')::BOOLEAN, true) IS FALSE,
    'replayed finalization must reuse the order'
  );

  SELECT COUNT(*) INTO v_integer
  FROM public.orders
  WHERE payment_id = 'pi_test_finalize_0001';
  PERFORM pg_temp.assert_true(v_integer = 1, 'payment must map to one order');

  SELECT num_items INTO v_integer
  FROM public.products
  WHERE id = v_product;
  PERFORM pg_temp.assert_true(
    v_integer = 1,
    'replayed finalization must not decrement inventory twice'
  );

  v_result := public.refund_paid_order('pi_test_finalize_0001');
  PERFORM pg_temp.assert_true(
    COALESCE((v_result->>'success')::BOOLEAN, false),
    'full refund must succeed'
  );

  SELECT num_items INTO v_integer
  FROM public.products
  WHERE id = v_product;
  PERFORM pg_temp.assert_true(v_integer = 2, 'refund must restore inventory');

  SELECT balance INTO v_numeric
  FROM public.user_credits
  WHERE user_id = v_user;
  PERFORM pg_temp.assert_true(v_numeric = 10, 'refund must restore user credit');

  SELECT total_spent INTO v_numeric
  FROM public.user_credits
  WHERE user_id = v_user;
  PERFORM pg_temp.assert_true(v_numeric = 0, 'refund must reverse total spent');

  SELECT balance INTO v_numeric
  FROM public.gift_cards
  WHERE code = 'TEST-GIFT-0001';
  PERFORM pg_temp.assert_true(v_numeric = 20, 'refund must restore gift-card value');

  SELECT usage_count INTO v_integer
  FROM public.promotions
  WHERE code = 'PROMO-TEST';
  PERFORM pg_temp.assert_true(v_integer = 0, 'refund must restore promotion usage');

  SELECT status INTO v_text
  FROM public.checkout_value_reservations
  WHERE id = v_reservation_id;
  PERFORM pg_temp.assert_true(v_text = 'refunded', 'reservation must be refunded');

  PERFORM public.refund_paid_order('pi_test_finalize_0001');
  SELECT num_items INTO v_integer
  FROM public.products
  WHERE id = v_product;
  PERFORM pg_temp.assert_true(
    v_integer = 2,
    'replayed refund must not restore inventory twice'
  );

  INSERT INTO public.pending_checkout_sessions (
    stripe_session_id,
    user_id,
    checkout_type,
    status,
    items,
    subtotal,
    discount_amount,
    gift_card_amount,
    user_credit_amount,
    shipping_cost,
    total,
    created_at,
    updated_at
  )
  VALUES
    (
      'cs_test_stale_pending_0001',
      v_user,
      'order',
      'created',
      '[]'::JSONB,
      0,
      0,
      0,
      0,
      0,
      0,
      NOW() - INTERVAL '26 hours',
      NOW() - INTERVAL '26 hours'
    ),
    (
      'cs_test_recent_pending_0001',
      v_user,
      'order',
      'created',
      '[]'::JSONB,
      0,
      0,
      0,
      0,
      0,
      0,
      NOW(),
      NOW()
    );

  PERFORM public.release_expired_checkout_reservations(100);

  SELECT status INTO v_text
  FROM public.pending_checkout_sessions
  WHERE stripe_session_id = 'cs_test_stale_pending_0001';
  PERFORM pg_temp.assert_true(
    v_text = 'expired',
    'stale unpaid checkout snapshot must expire'
  );

  SELECT status INTO v_text
  FROM public.pending_checkout_sessions
  WHERE stripe_session_id = 'cs_test_recent_pending_0001';
  PERFORM pg_temp.assert_true(
    v_text = 'created',
    'recent checkout snapshot must remain active'
  );
END;
$$;

DO $$
DECLARE
  v_claimed BOOLEAN;
  v_integer INTEGER;
  v_text TEXT;
BEGIN
  v_claimed := public.claim_stripe_webhook_event(
    'evt_payment_integrity_0001',
    'checkout.session.completed',
    NOW()
  );
  PERFORM pg_temp.assert_true(v_claimed, 'new Stripe event must be claimed');

  v_claimed := public.claim_stripe_webhook_event(
    'evt_payment_integrity_0001',
    'checkout.session.completed',
    NOW()
  );
  PERFORM pg_temp.assert_true(
    NOT v_claimed,
    'active Stripe event lease must reject concurrent replay'
  );

  PERFORM public.complete_stripe_webhook_event(
    'evt_payment_integrity_0001',
    false,
    'synthetic retry'
  );
  v_claimed := public.claim_stripe_webhook_event(
    'evt_payment_integrity_0001',
    'checkout.session.completed',
    NOW()
  );
  PERFORM pg_temp.assert_true(v_claimed, 'failed Stripe event must be retryable');

  PERFORM public.complete_stripe_webhook_event(
    'evt_payment_integrity_0001',
    true,
    NULL
  );
  v_claimed := public.claim_stripe_webhook_event(
    'evt_payment_integrity_0001',
    'checkout.session.completed',
    NOW()
  );
  PERFORM pg_temp.assert_true(
    NOT v_claimed,
    'processed Stripe event must never be claimed again'
  );

  SELECT attempts, status
  INTO v_integer, v_text
  FROM public.stripe_webhook_events
  WHERE event_id = 'evt_payment_integrity_0001';
  PERFORM pg_temp.assert_true(v_integer = 2, 'event attempts must be counted');
  PERFORM pg_temp.assert_true(v_text = 'processed', 'event must remain processed');
END;
$$;

SELECT 'payment_database_integrity_test: ok' AS result;

ROLLBACK;
