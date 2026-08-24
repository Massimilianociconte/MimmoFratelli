-- Atomic increment of the referral counter in user_referral_codes.
-- Replaces the read-modify-write pattern used by handle-signup which was
-- prone to lost updates when two referred users signed up concurrently.

CREATE OR REPLACE FUNCTION increment_referral_count(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE user_referral_codes
  SET total_referrals = COALESCE(total_referrals, 0) + 1
  WHERE user_id = p_user_id
  RETURNING total_referrals INTO new_count;

  RETURN COALESCE(new_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION increment_referral_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_referral_count(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_referral_count(UUID) TO service_role;
