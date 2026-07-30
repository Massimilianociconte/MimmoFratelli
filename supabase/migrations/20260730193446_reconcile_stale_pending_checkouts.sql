-- Keep the operational checkout snapshot aligned with released reservations.
-- A legacy "created" row older than Stripe's maximum 24-hour Checkout expiry
-- is safe to expire only when it has no recorded payment ID. Paid/completed
-- rows are deliberately excluded for manual reconciliation.

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
    SELECT id, stripe_session_id
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

    IF v_row.stripe_session_id IS NOT NULL THEN
      UPDATE public.pending_checkout_sessions
      SET
        status = 'expired',
        updated_at = NOW()
      WHERE stripe_session_id = v_row.stripe_session_id
        AND status = 'created'
        AND stripe_payment_id IS NULL;
    END IF;

    v_released := v_released + 1;
  END LOOP;

  -- Reconcile pre-reservation checkout snapshots in bounded batches. Stripe
  -- Checkout cannot remain open beyond 24 hours; one extra hour absorbs clock
  -- skew and delayed database writes.
  WITH stale_pending AS (
    SELECT id
    FROM public.pending_checkout_sessions
    WHERE status = 'created'
      AND stripe_payment_id IS NULL
      AND completed_at IS NULL
      AND created_at <= NOW() - INTERVAL '25 hours'
    ORDER BY created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.pending_checkout_sessions AS pending
  SET
    status = 'expired',
    updated_at = NOW()
  FROM stale_pending
  WHERE pending.id = stale_pending.id;

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.release_expired_checkout_reservations(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_checkout_reservations(INTEGER)
  TO service_role;
