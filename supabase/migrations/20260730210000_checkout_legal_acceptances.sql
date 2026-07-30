-- Mimmo Fratelli E-commerce Platform
-- Durable evidence of the legal-document versions accepted in Stripe Checkout.
--
-- Stripe remains the source of truth for the checkbox itself. This table stores
-- only the minimum evidence needed to associate its result with our immutable
-- version identifiers; it contains no card data.

CREATE TABLE IF NOT EXISTS public.checkout_legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  checkout_type TEXT NOT NULL CHECK (checkout_type IN ('order', 'gift_card')),
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  stripe_terms_status TEXT NOT NULL CHECK (stripe_terms_status = 'accepted'),
  checkout_session_created_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  livemode BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkout_legal_acceptances_user_recorded
  ON public.checkout_legal_acceptances(user_id, recorded_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.checkout_legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_legal_acceptances FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_legal_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.checkout_legal_acceptances TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.checkout_legal_acceptances TO service_role;

DROP POLICY IF EXISTS "Users can view own checkout legal acceptances"
  ON public.checkout_legal_acceptances;
CREATE POLICY "Users can view own checkout legal acceptances"
  ON public.checkout_legal_acceptances
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can view checkout legal acceptances"
  ON public.checkout_legal_acceptances;
CREATE POLICY "Admins can view checkout legal acceptances"
  ON public.checkout_legal_acceptances
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

COMMENT ON TABLE public.checkout_legal_acceptances IS
  'Minimal durable evidence of Stripe Checkout terms acceptance and document versions';
COMMENT ON COLUMN public.checkout_legal_acceptances.recorded_at IS
  'Webhook processing time; not represented as the exact instant of the customer click';
