-- Avenue M. E-commerce Platform
-- Migration 006: Gift Card QR Codes and User Credits
-- Adds QR code system, user credits, and redemption tracking

-- ============================================
-- ADD QR CODE AND REDEMPTION FIELDS TO GIFT_CARDS
-- ============================================
ALTER TABLE gift_cards 
ADD COLUMN IF NOT EXISTS qr_code_token UUID DEFAULT uuid_generate_v4() UNIQUE,
ADD COLUMN IF NOT EXISTS is_redeemed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS redeemed_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS remaining_balance DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS purchaser_first_name TEXT,
ADD COLUMN IF NOT EXISTS purchaser_last_name TEXT;

-- Set remaining_balance equal to amount for existing cards
UPDATE gift_cards SET remaining_balance = amount WHERE remaining_balance IS NULL;

-- Make remaining_balance NOT NULL with default
ALTER TABLE gift_cards ALTER COLUMN remaining_balance SET DEFAULT 0;

-- ============================================
-- USER CREDITS TABLE
-- Tracks credit balance for each user
-- ============================================
CREATE TABLE IF NOT EXISTS user_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    balance DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    total_earned DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_spent DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CREDIT TRANSACTIONS TABLE
-- Audit trail for all credit movements
-- ============================================
CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('gift_card_redeem', 'purchase', 'refund', 'admin_adjustment')),
    reference_id UUID, -- gift_card_id or order_id
    reference_type TEXT, -- 'gift_card' or 'order'
    balance_before DECIMAL(10,2) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_gift_cards_qr_token ON gift_cards(qr_code_token);
CREATE INDEX IF NOT EXISTS idx_gift_cards_redeemed_by ON gift_cards(redeemed_by);
CREATE INDEX IF NOT EXISTS idx_gift_cards_purchaser_name ON gift_cards(purchaser_last_name, purchaser_first_name);
CREATE INDEX IF NOT EXISTS idx_user_credits_user ON user_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(transaction_type);

-- ============================================
-- FUNCTION: Redeem Gift Card
-- Securely redeems a gift card and credits user
-- ============================================
CREATE OR REPLACE FUNCTION redeem_gift_card(
    p_qr_token UUID,
    p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_gift_card RECORD;
    v_current_balance DECIMAL(10,2);
    v_new_balance DECIMAL(10,2);
BEGIN
    -- Lock the gift card row to prevent race conditions
    SELECT * INTO v_gift_card 
    FROM gift_cards 
    WHERE qr_code_token = p_qr_token 
    FOR UPDATE;
    
    -- Check if gift card exists
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Gift card non trovata');
    END IF;
    
    -- Check if already redeemed
    IF v_gift_card.is_redeemed THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'Questa gift card è già stata riscattata',
            'redeemed_at', v_gift_card.redeemed_at
        );
    END IF;
    
    -- Check if gift card is active
    IF NOT v_gift_card.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Gift card non attiva');
    END IF;
    
    -- Check expiration
    IF v_gift_card.expires_at IS NOT NULL AND v_gift_card.expires_at < NOW() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Gift card scaduta');
    END IF;
    
    -- Get or create user credit record
    INSERT INTO user_credits (user_id, balance, total_earned)
    VALUES (p_user_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    
    SELECT balance INTO v_current_balance 
    FROM user_credits 
    WHERE user_id = p_user_id 
    FOR UPDATE;
    
    v_new_balance := v_current_balance + v_gift_card.amount;
    
    -- Update user credits
    UPDATE user_credits 
    SET balance = v_new_balance,
        total_earned = total_earned + v_gift_card.amount,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Mark gift card as redeemed
    UPDATE gift_cards 
    SET is_redeemed = TRUE,
        redeemed_by = p_user_id,
        redeemed_at = NOW(),
        remaining_balance = 0
    WHERE id = v_gift_card.id;
    
    -- Record transaction
    INSERT INTO credit_transactions (
        user_id, amount, transaction_type, 
        reference_id, reference_type,
        balance_before, balance_after, description
    ) VALUES (
        p_user_id, v_gift_card.amount, 'gift_card_redeem',
        v_gift_card.id, 'gift_card',
        v_current_balance, v_new_balance,
        'Riscatto gift card ' || v_gift_card.code
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'amount', v_gift_card.amount,
        'new_balance', v_new_balance,
        'gift_card_code', v_gift_card.code
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- FUNCTION: Use Credits for Purchase
-- Deducts credits from user balance
-- ============================================
CREATE OR REPLACE FUNCTION use_credits(
    p_user_id UUID,
    p_amount DECIMAL(10,2),
    p_order_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_current_balance DECIMAL(10,2);
    v_new_balance DECIMAL(10,2);
BEGIN
    -- Get current balance with lock
    SELECT balance INTO v_current_balance 
    FROM user_credits 
    WHERE user_id = p_user_id 
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nessun credito disponibile');
    END IF;
    
    IF v_current_balance < p_amount THEN
        RETURN jsonb_build_object(
            'success', false, 
            'error', 'Credito insufficiente',
            'available', v_current_balance,
            'requested', p_amount
        );
    END IF;
    
    v_new_balance := v_current_balance - p_amount;
    
    -- Update balance
    UPDATE user_credits 
    SET balance = v_new_balance,
        total_spent = total_spent + p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    -- Record transaction
    INSERT INTO credit_transactions (
        user_id, amount, transaction_type,
        reference_id, reference_type,
        balance_before, balance_after, description
    ) VALUES (
        p_user_id, -p_amount, 'purchase',
        p_order_id, 'order',
        v_current_balance, v_new_balance,
        'Utilizzo credito per ordine'
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'amount_used', p_amount,
        'new_balance', v_new_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own credits
CREATE POLICY "Users can view own credits"
    ON user_credits FOR SELECT
    USING (auth.uid() = user_id);

-- Users can only see their own transactions
CREATE POLICY "Users can view own transactions"
    ON credit_transactions FOR SELECT
    USING (auth.uid() = user_id);

-- Admins can view all
CREATE POLICY "Admins can view all credits"
    ON user_credits FOR ALL
    USING (is_admin());

CREATE POLICY "Admins can view all transactions"
    ON credit_transactions FOR ALL
    USING (is_admin());

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE user_credits IS 'User credit balances from redeemed gift cards';
COMMENT ON TABLE credit_transactions IS 'Audit trail for all credit movements';
COMMENT ON FUNCTION redeem_gift_card IS 'Securely redeems a gift card QR code and credits user account';
COMMENT ON FUNCTION use_credits IS 'Deducts credits from user balance for purchases';
