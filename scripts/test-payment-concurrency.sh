#!/usr/bin/env zsh

set -euo pipefail

payment_test_db_container="${PAYMENT_TEST_DB_CONTAINER:-supabase_db_Sito_Mimmo_Fratelli}"

if ! docker inspect "$payment_test_db_container" >/dev/null 2>&1; then
  print -u2 "Local Supabase database container not found: $payment_test_db_container"
  exit 1
fi

run_sql() {
  docker exec "$payment_test_db_container" \
    psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 "$@"
}

cleanup() {
  run_sql -q -c "
    DELETE FROM auth.users
    WHERE id IN (
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012'
    );
    DELETE FROM public.products
    WHERE id IN (
      '10000000-0000-4000-8000-000000000011',
      '10000000-0000-4000-8000-000000000012'
    );
  " >/dev/null
}

trap cleanup EXIT
cleanup

run_sql -q -c "
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
  VALUES
    (
      '00000000-0000-4000-8000-000000000011',
      'authenticated',
      'authenticated',
      'credit-race@example.invalid',
      '{}',
      '{}',
      NOW(),
      NOW()
    ),
    (
      '00000000-0000-4000-8000-000000000012',
      'authenticated',
      'authenticated',
      'stock-race@example.invalid',
      '{}',
      '{}',
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
  VALUES
    (
      '10000000-0000-4000-8000-000000000011',
      'Credit race product',
      'credit-race-product',
      10,
      10,
      10,
      'pz',
      true
    ),
    (
      '10000000-0000-4000-8000-000000000012',
      'Stock race product',
      'stock-race-product',
      10,
      1,
      1,
      'pz',
      true
    );

  INSERT INTO public.user_credits (
    user_id,
    balance,
    total_earned,
    total_spent
  )
  VALUES (
    '00000000-0000-4000-8000-000000000011',
    10,
    10,
    0
  );
"

credit_items_sql="jsonb_build_array(jsonb_build_object(
  'product_id',
  '10000000-0000-4000-8000-000000000011',
  'quantity',
  1
))"
stock_items_sql="jsonb_build_array(jsonb_build_object(
  'product_id',
  '10000000-0000-4000-8000-000000000012',
  'quantity',
  1
))"

set +e
run_sql -qAt -c "
  SELECT public.reserve_checkout_value(
    '00000000-0000-4000-8000-000000000011',
    'payment-credit-race-key-000001',
    8,
    NULL,
    0,
    NULL,
    10,
    $credit_items_sql
  );
" &
credit_pid_one=$!
run_sql -qAt -c "
  SELECT public.reserve_checkout_value(
    '00000000-0000-4000-8000-000000000011',
    'payment-credit-race-key-000002',
    8,
    NULL,
    0,
    NULL,
    10,
    $credit_items_sql
  );
" &
credit_pid_two=$!

wait "$credit_pid_one"
credit_status_one=$?
wait "$credit_pid_two"
credit_status_two=$?

credit_successes=$((
  (credit_status_one == 0)
  + (credit_status_two == 0)
))
if (( credit_successes != 1 )); then
  print -u2 "Credit race expected one success; got $credit_successes"
  exit 1
fi

run_sql -qAt -c "
  SELECT public.reserve_checkout_value(
    '00000000-0000-4000-8000-000000000012',
    'payment-stock-race-key-0000001',
    0,
    NULL,
    0,
    NULL,
    10,
    $stock_items_sql
  );
" &
stock_pid_one=$!
run_sql -qAt -c "
  SELECT public.reserve_checkout_value(
    '00000000-0000-4000-8000-000000000012',
    'payment-stock-race-key-0000002',
    0,
    NULL,
    0,
    NULL,
    10,
    $stock_items_sql
  );
" &
stock_pid_two=$!

wait "$stock_pid_one"
stock_status_one=$?
wait "$stock_pid_two"
stock_status_two=$?
set -e

stock_successes=$((
  (stock_status_one == 0)
  + (stock_status_two == 0)
))
if (( stock_successes != 1 )); then
  print -u2 "Stock race expected one success; got $stock_successes"
  exit 1
fi

run_sql -qAt -c "
  SELECT 1 / (
    (
      (
        SELECT balance = 2
        FROM public.user_credits
        WHERE user_id = '00000000-0000-4000-8000-000000000011'
      )
      AND (
        SELECT COUNT(*) = 1
        FROM public.checkout_value_reservations
        WHERE user_id = '00000000-0000-4000-8000-000000000011'
          AND status = 'reserved'
      )
      AND (
        SELECT COUNT(*) = 1
        FROM public.checkout_value_reservations
        WHERE user_id = '00000000-0000-4000-8000-000000000012'
          AND status = 'reserved'
      )
    )::INTEGER
  );
" >/dev/null

print "payment concurrency test: ok"
