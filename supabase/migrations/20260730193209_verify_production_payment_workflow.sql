-- Execute a production-schema payment smoke test inside a PL/pgSQL
-- subtransaction. A sentinel exception rolls back every synthetic row after
-- all assertions pass, while any unexpected error aborts the migration.

DO $outer$
DECLARE
  v_user UUID := 'f0000000-0000-4000-8000-000000000001';
  v_product UUID := 'f1000000-0000-4000-8000-000000000001';
  v_items JSONB;
  v_result JSONB;
  v_reservation_id UUID;
  v_order_id UUID;
  v_numeric NUMERIC;
  v_integer INTEGER;
  v_text TEXT;
  v_sentinel_message TEXT;
BEGIN
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
      'production-payment-smoke@example.invalid',
      '{}'::JSONB,
      '{"first_name":"Production","last_name":"Smoke"}'::JSONB,
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
      'Production payment smoke product',
      'production-payment-smoke-product',
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
      'PROD-SMOKE-0001',
      20,
      20,
      20,
      'Production Smoke',
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
      'Production payment smoke promotion',
      'fixed',
      1,
      0,
      'PROD-SMOKE-PROMO',
      1,
      0,
      NOW() - INTERVAL '1 day',
      NOW() + INTERVAL '1 day',
      true
    );

    v_items := jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product,
        'product_name', 'Production payment smoke product',
        'product_price', 20,
        'quantity', 1,
        'size', 'Standard',
        'color', 'Fresco'
      )
    );

    v_result := public.reserve_checkout_value(
      v_user,
      'production-payment-smoke-20260730-0001',
      3,
      'PROD-SMOKE-0001',
      4,
      'PROD-SMOKE-PROMO',
      20,
      v_items
    );
    v_reservation_id := (v_result->>'reservation_id')::UUID;

    IF COALESCE((v_result->>'success')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Production smoke reservation failed';
    END IF;

    PERFORM public.bind_checkout_value_reservation(
      v_reservation_id,
      'cs_production_payment_smoke_20260730'
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
      'cs_production_payment_smoke_20260730',
      v_user,
      'order',
      'created',
      'production-payment-smoke@example.invalid',
      v_items,
      '{"line1":"Smoke","city":"Smoke","postal_code":"00000","country":"IT"}'::JSONB,
      20,
      0,
      4,
      3,
      0,
      13,
      'PROD-SMOKE-PROMO',
      'PROD-SMOKE-0001'
    );

    v_result := public.finalize_paid_order(
      'cs_production_payment_smoke_20260730',
      'pi_production_payment_smoke_20260730',
      v_user,
      1300
    );
    v_order_id := (v_result->>'order_id')::UUID;

    IF COALESCE((v_result->>'success')::BOOLEAN, false) IS NOT TRUE
      OR COALESCE((v_result->>'created')::BOOLEAN, false) IS NOT TRUE
    THEN
      RAISE EXCEPTION 'Production smoke finalization failed';
    END IF;

    SELECT num_items
    INTO v_integer
    FROM public.products
    WHERE id = v_product;
    IF v_integer <> 1 THEN
      RAISE EXCEPTION 'Production smoke inventory decrement was not exact';
    END IF;

    SELECT status
    INTO v_text
    FROM public.checkout_value_reservations
    WHERE id = v_reservation_id;
    IF v_text <> 'consumed' THEN
      RAISE EXCEPTION 'Production smoke reservation was not consumed';
    END IF;

    v_result := public.finalize_paid_order(
      'cs_production_payment_smoke_20260730',
      'pi_production_payment_smoke_20260730',
      v_user,
      1300
    );
    IF COALESCE((v_result->>'created')::BOOLEAN, true) IS NOT FALSE THEN
      RAISE EXCEPTION 'Production smoke replay created a duplicate order';
    END IF;

    SELECT COUNT(*)
    INTO v_integer
    FROM public.orders
    WHERE payment_id = 'pi_production_payment_smoke_20260730';
    IF v_integer <> 1 THEN
      RAISE EXCEPTION 'Production smoke payment does not map to one order';
    END IF;

    v_result := public.refund_paid_order(
      'pi_production_payment_smoke_20260730'
    );
    IF COALESCE((v_result->>'success')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Production smoke refund failed';
    END IF;

    SELECT num_items
    INTO v_integer
    FROM public.products
    WHERE id = v_product;
    IF v_integer <> 2 THEN
      RAISE EXCEPTION 'Production smoke refund did not restore inventory';
    END IF;

    SELECT balance
    INTO v_numeric
    FROM public.user_credits
    WHERE user_id = v_user;
    IF v_numeric <> 10 THEN
      RAISE EXCEPTION 'Production smoke refund did not restore user credit';
    END IF;

    SELECT balance
    INTO v_numeric
    FROM public.gift_cards
    WHERE code = 'PROD-SMOKE-0001';
    IF v_numeric <> 20 THEN
      RAISE EXCEPTION 'Production smoke refund did not restore gift-card value';
    END IF;

    IF NOT public.claim_stripe_webhook_event(
      'evt_production_payment_smoke_20260730',
      'checkout.session.completed',
      NOW()
    ) THEN
      RAISE EXCEPTION 'Production smoke could not claim a new Stripe event';
    END IF;

    IF public.claim_stripe_webhook_event(
      'evt_production_payment_smoke_20260730',
      'checkout.session.completed',
      NOW()
    ) THEN
      RAISE EXCEPTION 'Production smoke accepted a concurrent event replay';
    END IF;

    PERFORM public.complete_stripe_webhook_event(
      'evt_production_payment_smoke_20260730',
      true,
      NULL
    );

    IF public.claim_stripe_webhook_event(
      'evt_production_payment_smoke_20260730',
      'checkout.session.completed',
      NOW()
    ) THEN
      RAISE EXCEPTION 'Production smoke reclaimed a processed Stripe event';
    END IF;

    -- Force rollback of every synthetic write in this inner subtransaction.
    RAISE EXCEPTION 'production_payment_smoke_passed'
      USING ERRCODE = 'PT001';
  EXCEPTION
    WHEN SQLSTATE 'PT001' THEN
      GET STACKED DIAGNOSTICS v_sentinel_message = MESSAGE_TEXT;
      IF v_sentinel_message <> 'production_payment_smoke_passed' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE payment_id = 'pi_production_payment_smoke_20260730'
  ) OR EXISTS (
    SELECT 1
    FROM public.stripe_webhook_events
    WHERE event_id = 'evt_production_payment_smoke_20260730'
  ) OR EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = v_user
  ) THEN
    RAISE EXCEPTION 'Production payment smoke rollback left synthetic rows';
  END IF;
END;
$outer$;
