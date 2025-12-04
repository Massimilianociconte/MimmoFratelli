-- Mimmo Fratelli E-commerce Platform
-- Migration 011: Referral System and First Order Discounts
-- Creates referrals, user_referral_codes, and system_config tables
-- Extends promotions table for first-order codes

-- ============================================
-- SYSTEM CONFIG TABLE
-- Configurable parameters for the platform
-- ============================================
CREATE TABLE IF NOT EXISTS system_config (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Insert default configuration values
INSERT INTO system_config (key, value, description) VALUES
  ('first_order_discount', '{"percentage": 10, "validity_days": 30}', 'Sconto primo ordine standard'),
  ('referral_first_order_discount', '{"percentage": 15, "validity_days": 30}', 'Sconto primo ordine con referral'),
  ('referral_reward', '{"amount": 5, "currency": "EUR"}', 'Credito per il referrer'),
  ('referral_limits', '{"max_per_ip_daily": 3, "review_threshold": 50, "refund_window_days": 14}', 'Limiti anti-abuso referral')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- USER REFERRAL CODES TABLE
-- Permanent referral codes for each user
-- ============================================
CREATE TABLE IF NOT EXISTS user_referral_codes (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code VARCHAR(8) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  total_referrals INTEGER DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  total_earned DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON user_referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_active ON user_referral_codes(is_active) WHERE is_active = TRUE;

-- ============================================
-- REFERRALS TABLE
-- Tracks referral relationships and rewards
-- ============================================
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code VARCHAR(8) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'revoked')),
  reward_amount DECIMAL(10,2) DEFAULT 5.00,
  reward_credited BOOLEAN DEFAULT FALSE,
  ip_address INET,
  converted_at TIMESTAMPTZ,
  converted_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(referee_id),
  CONSTRAINT no_self_referral CHECK (referrer_id != referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referee ON referrals(referee_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_ip_date ON referrals(ip_address, created_at);

-- ============================================
-- EXTEND PROMOTIONS TABLE
-- Add columns for first-order codes
-- ============================================
ALTER TABLE promotions 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_first_order_code BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS referral_bonus BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_promotions_user ON promotions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_first_order ON promotions(is_first_order_code) WHERE is_first_order_code = TRUE;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Generate unique 8-character referral code
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS VARCHAR(8) AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code VARCHAR(8) := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    code := code || SUBSTR(chars, FLOOR(RANDOM() * LENGTH(chars) + 1)::INTEGER, 1);
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- Generate unique first-order promo code
CREATE OR REPLACE FUNCTION generate_first_order_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  suffix TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    suffix := suffix || SUBSTR(chars, FLOOR(RANDOM() * LENGTH(chars) + 1)::INTEGER, 1);
  END LOOP;
  RETURN 'BENVENUTO' || suffix;
END;
$$ LANGUAGE plpgsql;

-- Check if user has completed any orders
CREATE OR REPLACE FUNCTION user_has_completed_orders(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM orders 
    WHERE user_id = p_user_id 
    AND payment_status = 'completed'
  );
END;
$$ LANGUAGE plpgsql;

-- Get referral code owner
CREATE OR REPLACE FUNCTION get_referral_code_owner(p_code VARCHAR(8))
RETURNS UUID AS $$
DECLARE
  owner_id UUID;
BEGIN
  SELECT user_id INTO owner_id 
  FROM user_referral_codes 
  WHERE code = UPPER(p_code) AND is_active = TRUE;
  RETURN owner_id;
END;
$$ LANGUAGE plpgsql;

-- Count IP conversions in last 24 hours
CREATE OR REPLACE FUNCTION count_ip_conversions_today(p_ip INET)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*) FROM referrals 
    WHERE ip_address = p_ip 
    AND status = 'converted'
    AND converted_at >= NOW() - INTERVAL '24 hours'
  );
END;
$$ LANGUAGE plpgsql;

-- Process referral conversion (called from webhook)
CREATE OR REPLACE FUNCTION process_referral_conversion(
  p_referee_id UUID,
  p_order_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_referral RECORD;
  v_ip_count INTEGER;
  v_max_per_ip INTEGER;
  v_result JSONB;
BEGIN
  -- Get pending referral for this user
  SELECT * INTO v_referral 
  FROM referrals 
  WHERE referee_id = p_referee_id AND status = 'pending'
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_pending_referral');
  END IF;
  
  -- Check IP rate limit
  SELECT (value->>'max_per_ip_daily')::INTEGER INTO v_max_per_ip
  FROM system_config WHERE key = 'referral_limits';
  
  v_ip_count := count_ip_conversions_today(v_referral.ip_address);
  
  IF v_ip_count >= COALESCE(v_max_per_ip, 3) THEN
    -- Update status but don't credit reward
    UPDATE referrals SET 
      status = 'converted',
      converted_at = NOW(),
      converted_order_id = p_order_id,
      reward_credited = FALSE
    WHERE id = v_referral.id;
    
    RETURN jsonb_build_object('success', true, 'reward_credited', false, 'reason', 'ip_limit_exceeded');
  END IF;
  
  -- Update referral status
  UPDATE referrals SET 
    status = 'converted',
    converted_at = NOW(),
    converted_order_id = p_order_id,
    reward_credited = TRUE
  WHERE id = v_referral.id;
  
  -- Credit referrer
  INSERT INTO user_credits (user_id, balance, total_earned)
  VALUES (v_referral.referrer_id, v_referral.reward_amount, v_referral.reward_amount)
  ON CONFLICT (user_id) DO UPDATE SET
    balance = user_credits.balance + v_referral.reward_amount,
    total_earned = user_credits.total_earned + v_referral.reward_amount;
  
  -- Record transaction
  INSERT INTO credit_transactions (user_id, amount, type, description, reference_id)
  VALUES (
    v_referral.referrer_id, 
    v_referral.reward_amount, 
    'referral_reward',
    'Reward per referral convertito',
    v_referral.id
  );
  
  -- Update referrer stats
  UPDATE user_referral_codes SET
    total_conversions = total_conversions + 1,
    total_earned = total_earned + v_referral.reward_amount
  WHERE user_id = v_referral.referrer_id;
  
  RETURN jsonb_build_object(
    'success', true, 
    'reward_credited', true, 
    'referrer_id', v_referral.referrer_id,
    'reward_amount', v_referral.reward_amount
  );
END;
$$ LANGUAGE plpgsql;

-- Revoke referral reward (for refunds)
CREATE OR REPLACE FUNCTION revoke_referral_reward(
  p_order_id UUID,
  p_reason TEXT DEFAULT 'order_refunded'
)
RETURNS JSONB AS $$
DECLARE
  v_referral RECORD;
  v_refund_window INTEGER;
BEGIN
  -- Get referral for this order
  SELECT r.*, 
    (SELECT (value->>'refund_window_days')::INTEGER FROM system_config WHERE key = 'referral_limits') as refund_window
  INTO v_referral 
  FROM referrals r
  WHERE converted_order_id = p_order_id 
  AND status = 'converted'
  AND reward_credited = TRUE
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_eligible_referral');
  END IF;
  
  -- Check if within refund window
  IF v_referral.converted_at + (COALESCE(v_referral.refund_window, 14) || ' days')::INTERVAL < NOW() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'outside_refund_window');
  END IF;
  
  -- Update referral status
  UPDATE referrals SET 
    status = 'revoked',
    revoked_at = NOW(),
    revoke_reason = p_reason
  WHERE id = v_referral.id;
  
  -- Deduct from referrer balance
  UPDATE user_credits SET
    balance = GREATEST(0, balance - v_referral.reward_amount)
  WHERE user_id = v_referral.referrer_id;
  
  -- Record negative transaction
  INSERT INTO credit_transactions (user_id, amount, type, description, reference_id)
  VALUES (
    v_referral.referrer_id, 
    -v_referral.reward_amount, 
    'referral_revoked',
    'Revoca reward per rimborso ordine',
    v_referral.id
  );
  
  -- Update referrer stats
  UPDATE user_referral_codes SET
    total_conversions = GREATEST(0, total_conversions - 1),
    total_earned = GREATEST(0, total_earned - v_referral.reward_amount)
  WHERE user_id = v_referral.referrer_id;
  
  RETURN jsonb_build_object(
    'success', true, 
    'referrer_id', v_referral.referrer_id,
    'amount_revoked', v_referral.reward_amount
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- System config: read-only for all, write for admins
CREATE POLICY "Anyone can read system config" ON system_config
  FOR SELECT USING (true);

CREATE POLICY "Admins can update system config" ON system_config
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- User referral codes: users can read their own
CREATE POLICY "Users can read own referral code" ON user_referral_codes
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can read any active referral code" ON user_referral_codes
  FOR SELECT USING (is_active = TRUE);

-- Referrals: users can read their own (as referrer or referee)
CREATE POLICY "Users can read own referrals" ON referrals
  FOR SELECT USING (referrer_id = auth.uid() OR referee_id = auth.uid());

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE system_config IS 'Configurable system parameters';
COMMENT ON TABLE user_referral_codes IS 'Permanent referral codes for users';
COMMENT ON TABLE referrals IS 'Referral relationships and reward tracking';
COMMENT ON COLUMN promotions.is_first_order_code IS 'True if this is an auto-generated first order discount';
COMMENT ON COLUMN promotions.referral_bonus IS 'True if discount was upgraded due to referral';
COMMENT ON COLUMN referrals.status IS 'pending = awaiting first order, converted = order completed, revoked = refunded';
