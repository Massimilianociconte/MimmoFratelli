-- Fail closed if the provider accepted pg_cron but did not persist/activate
-- the exact jobs required by the checkout reservation lifecycle.

DO $$
DECLARE
  v_expected_jobs INTEGER;
  v_scheduler_active BOOLEAN;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO v_expected_jobs
  FROM cron.job
  WHERE active
    AND (
      (
        jobname = 'release-expired-checkout-reservations'
        AND schedule = '*/5 * * * *'
        AND command =
          'SELECT public.release_expired_checkout_reservations(100);'
      )
      OR (
        jobname = 'prune-mimmo-cron-history'
        AND schedule = '17 3 * * *'
      )
    );

  SELECT EXISTS (
    SELECT 1
    FROM pg_stat_activity
    WHERE application_name = 'pg_cron scheduler'
      OR backend_type = 'pg_cron launcher'
  )
  INTO v_scheduler_active;

  IF v_expected_jobs <> 2 OR NOT v_scheduler_active THEN
    RAISE EXCEPTION
      'Checkout reservation cleanup validation failed: jobs=%, scheduler_active=%',
      v_expected_jobs,
      v_scheduler_active;
  END IF;

  IF has_schema_privilege('anon', 'cron', 'USAGE')
    OR has_schema_privilege('authenticated', 'cron', 'USAGE')
  THEN
    RAISE EXCEPTION 'Client roles retain access to the cron schema';
  END IF;
END;
$$;
