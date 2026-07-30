-- Supabase Cron is the provider-supported pg_cron module. It guarantees that
-- expired checkout reservations are released even during periods with no
-- storefront traffic or Stripe expiry webhook delivery.

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'release-expired-checkout-reservations',
  '*/5 * * * *',
  'SELECT public.release_expired_checkout_reservations(100);'
);

-- Bound scheduler metadata growth. Keep enough history for operational
-- diagnosis while removing completed run records older than fourteen days.
SELECT cron.schedule(
  'prune-mimmo-cron-history',
  '17 3 * * *',
  $command$
    DELETE FROM cron.job_run_details
    WHERE end_time IS NOT NULL
      AND end_time < NOW() - INTERVAL '14 days';
  $command$
);

REVOKE USAGE ON SCHEMA cron FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA cron FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cron FROM PUBLIC, anon, authenticated;
