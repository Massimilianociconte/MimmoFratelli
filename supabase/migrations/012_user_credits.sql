-- Mimmo Fratelli E-commerce Platform
-- Migration 012: Fix process_referral_conversion function
-- Updates the function to use correct table structure

-- Fix process_referral_conversion to use correct table structure
CREATE OR REPLACE FUNCTION process_referral_conversion(
  p_referee_id UUID,
  p_order_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_referral RECORD;
  v_ip_count INTEGER;
  v_max_per_ip INTEGER;
  v_current_balance DECIMAL(10,2);
  v_new_balance DECIMAL(10,2);
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
  
  -- Get current balance or 0 if no record exists
  SELECT COALESCE(balance, 0) INTO v_current_balance
  FROM user_credits WHERE user_id = v_referral.referrer_id;
  
  IF NOT FOUND THEN
    v_current_balance := 0;
  END IF;
  
  v_new_balance := v_current_balance + v_referral.reward_amount;
  
  -- Credit referrer (upsert)
  INSERT INTO user_credits (user_id, balance, total_earned, total_spent)
  VALUES (v_referral.referrer_id, v_referral.reward_amount, v_referral.reward_amount, 0)
  ON CONFLICT (user_id) DO UPDATE SET
    balance = user_credits.balance + v_referral.reward_amount,
    total_earned = user_credits.total_earned + v_referral.reward_amount,
    updated_at = NOW();
  
  -- Record transaction
  INSERT INTO credit_transactions (user_id, amount, transaction_type, description, reference_id, reference_type, balance_before, balance_after)
  VALUES (
    v_referral.referrer_id, 
    v_referral.reward_amount, 
    'referral_reward',
    'Reward per referral convertito',
    v_referral.id,
    'referral',
    v_current_balance,
    v_new_balance
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
