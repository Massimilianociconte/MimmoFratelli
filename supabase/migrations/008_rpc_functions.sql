-- RPC Functions for Avenue M. E-commerce
-- Promotion usage increment and other utility functions

-- Increment promotion usage counter
CREATE OR REPLACE FUNCTION increment_promotion_usage(promo_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE promotions 
    SET current_uses = current_uses + 1 
    WHERE id = promo_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Increment promotion usage by code
CREATE OR REPLACE FUNCTION increment_promotion_usage(promo_code TEXT)
RETURNS void AS $$
BEGIN
    UPDATE promotions 
    SET current_uses = current_uses + 1 
    WHERE code = UPPER(promo_code);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if gift card code is available
CREATE OR REPLACE FUNCTION is_gift_card_code_available(p_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    code_exists BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM used_gift_card_codes WHERE code = UPPER(p_code)
        UNION
        SELECT 1 FROM gift_cards WHERE code = UPPER(p_code)
    ) INTO code_exists;
    
    RETURN NOT code_exists;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reserve a gift card code (admin only)
CREATE OR REPLACE FUNCTION reserve_gift_card_code(p_code TEXT, p_reason TEXT DEFAULT 'reserved')
RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO used_gift_card_codes (code, reason)
    VALUES (UPPER(p_code), p_reason)
    ON CONFLICT (code) DO NOTHING;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Use credits for purchase
CREATE OR REPLACE FUNCTION use_credits(p_user_id UUID, p_amount DECIMAL, p_order_id UUID)
RETURNS JSON AS $$
DECLARE
    current_balance DECIMAL;
    new_balance DECIMAL;
BEGIN
    -- Get current balance
    SELECT balance INTO current_balance
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;
    
    IF current_balance IS NULL OR current_balance < p_amount THEN
        RETURN json_build_object('success', false, 'error', 'Credito insufficiente');
    END IF;
    
    new_balance := current_balance - p_amount;
    
    -- Update balance
    UPDATE user_credits
    SET balance = new_balance,
        total_spent = total_spent + p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Record transaction
    INSERT INTO credit_transactions (user_id, amount, type, description, order_id)
    VALUES (p_user_id, -p_amount, 'purchase', 'Utilizzo crediti per ordine', p_order_id);
    
    RETURN json_build_object('success', true, 'new_balance', new_balance);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Redeem gift card
CREATE OR REPLACE FUNCTION redeem_gift_card(p_qr_token TEXT, p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    gc RECORD;
    credit_amount DECIMAL;
BEGIN
    -- Get gift card
    SELECT * INTO gc
    FROM gift_cards
    WHERE qr_code_token = p_qr_token
    FOR UPDATE;
    
    IF gc IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Gift card non trovata');
    END IF;
    
    IF gc.is_redeemed THEN
        RETURN json_build_object('success', false, 'error', 'Gift card già riscattata');
    END IF;
    
    IF NOT gc.is_active THEN
        RETURN json_build_object('success', false, 'error', 'Gift card non attiva');
    END IF;
    
    IF gc.expires_at < NOW() THEN
        RETURN json_build_object('success', false, 'error', 'Gift card scaduta');
    END IF;
    
    credit_amount := gc.remaining_balance;
    
    -- Mark as redeemed
    UPDATE gift_cards
    SET is_redeemed = true,
        redeemed_by = p_user_id,
        redeemed_at = NOW(),
        remaining_balance = 0
    WHERE id = gc.id;
    
    -- Add credits to user
    INSERT INTO user_credits (user_id, balance, total_earned)
    VALUES (p_user_id, credit_amount, credit_amount)
    ON CONFLICT (user_id) DO UPDATE
    SET balance = user_credits.balance + credit_amount,
        total_earned = user_credits.total_earned + credit_amount,
        updated_at = NOW();
    
    -- Record transaction
    INSERT INTO credit_transactions (user_id, amount, type, description, gift_card_id)
    VALUES (p_user_id, credit_amount, 'gift_card_redemption', 'Riscatto gift card', gc.id);
    
    RETURN json_build_object('success', true, 'amount', credit_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit log entry
CREATE OR REPLACE FUNCTION create_audit_log(
    p_user_id UUID,
    p_action TEXT,
    p_details JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO audit_log (user_id, action, details)
    VALUES (p_user_id, p_action, p_details)
    RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
