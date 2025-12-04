-- Mimmo Fratelli E-commerce Platform
-- Migration 014: Referral Minimum Order Requirement
-- Adds €35 minimum order requirement for referral bonus

-- Update system_config with minimum order requirement
INSERT INTO system_config (key, value, description) VALUES
  ('referral_minimum_order', '{"amount": 35, "currency": "EUR"}', 'Importo minimo ordine per bonus referral €5')
ON CONFLICT (key) DO UPDATE SET
  value = '{"amount": 35, "currency": "EUR"}',
  description = 'Importo minimo ordine per bonus referral €5',
  updated_at = NOW();

-- Update process_referral_conversion to check minimum order amount
CREATE OR REPLACE FUNCTION process_referral_conversion(
  p_referee_id UUID,
  p_order_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_referral RECORD;
  v_order RECORD;
  v_ip_count INTEGER;
  v_max_per_ip INTEGER;
  v_min_order_amount DECIMAL(10,2);
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
  
  -- Get order details to check subtotal
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'order_not_found');
  END IF;
  
  -- Get minimum order amount from config (default €35)
  SELECT COALESCE((value->>'amount')::DECIMAL, 35.00) INTO v_min_order_amount
  FROM system_config WHERE key = 'referral_minimum_order';
  
  IF v_min_order_amount IS NULL THEN
    v_min_order_amount := 35.00;
  END IF;
  
  -- Check if order subtotal meets minimum requirement (excluding shipping)
  IF v_order.subtotal < v_min_order_amount THEN
    -- Update referral status to converted but don't credit reward
    UPDATE referrals SET 
      status = 'converted',
      converted_at = NOW(),
      converted_order_id = p_order_id,
      reward_credited = FALSE
    WHERE id = v_referral.id;
    
    RETURN jsonb_build_object(
      'success', true, 
      'reward_credited', false, 
      'reason', 'minimum_order_not_met',
      'order_subtotal', v_order.subtotal,
      'minimum_required', v_min_order_amount
    );
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

-- Add comment
COMMENT ON FUNCTION process_referral_conversion IS 'Processes referral conversion with €35 minimum order requirement for bonus credit';
