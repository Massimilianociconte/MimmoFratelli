-- Mimmo Fratelli E-commerce Platform
-- Forward-only production correction for Supabase default relation privileges.
--
-- The original migrations now contain the same least-privilege definitions for
-- clean installs. This migration also corrects databases where those migrations
-- had already run before the broad default grants were explicitly revoked.

REVOKE ALL ON TABLE public.checkout_legal_acceptances
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.checkout_legal_acceptances TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.checkout_legal_acceptances TO service_role;

REVOKE ALL ON TABLE public.product_price_history
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.product_price_history TO authenticated;
GRANT SELECT ON TABLE public.product_price_history TO service_role;

-- The price-history trigger is SECURITY DEFINER and runs as the table owner.
-- API roles therefore need no direct access to its identity sequence.
REVOKE ALL ON SEQUENCE public.product_price_history_id_seq
  FROM PUBLIC, anon, authenticated, service_role;
