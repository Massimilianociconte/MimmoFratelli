-- Avenue M. E-commerce Platform
-- Migration 007: Gift Card Code Blacklist
-- Ensures gift card codes are never reused, even after deletion

-- ============================================
-- USED GIFT CARD CODES TABLE (BLACKLIST)
-- Permanent record of all codes ever generated
-- ============================================
CREATE TABLE IF NOT EXISTS used_gift_card_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    qr_code_token UUID UNIQUE,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    gift_card_id UUID, -- Reference to original gift card (may be deleted)
    reason TEXT DEFAULT 'generated' -- 'generated', 'reserved', 'admin_blocked'
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_used_codes_code ON used_gift_card_codes(code);
CREATE INDEX IF NOT EXISTS idx_used_codes_qr_token ON used_gift_card_codes(qr_code_token);

-- ============================================
-- POPULATE BLACKLIST WITH EXISTING CODES
-- ============================================
INSERT INTO used_gift_card_codes (code, qr_code_token, gift_card_id, reason)
SELECT code, qr_code_token, id, 'generated'
FROM gift_cards
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- UPDATED FUNCTION: Generate Unique Gift Card Code
-- Now checks blacklist to prevent reuse
-- ============================================
CREATE OR REPLACE FUNCTION generate_gift_card_code()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    new_code TEXT := '';
    i INTEGER;
    max_attempts INTEGER := 100;
    attempt INTEGER := 0;
BEGIN
    LOOP
        new_code := '';
        -- Format: XXXX-XXXX-XXXX
        FOR i IN 1..12 LOOP
            new_code := new_code || SUBSTR(chars, FLOOR(RANDOM() * LENGTH(chars) + 1)::INTEGER, 1);
            IF i IN (4, 8) THEN
                new_code := new_code || '-';
            END IF;
        END LOOP;
        
        attempt := attempt + 1;
        
        -- Check both active gift cards AND blacklist
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM gift_cards WHERE code = new_code
        ) AND NOT EXISTS (
            SELECT 1 FROM used_gift_card_codes WHERE code = new_code
        );
        
        -- Safety: prevent infinite loop
        IF attempt >= max_attempts THEN
            RAISE EXCEPTION 'Unable to generate unique gift card code after % attempts', max_attempts;
        END IF;
    END LOOP;
    
    RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER: Add code to blacklist on insert
-- ============================================
CREATE OR REPLACE FUNCTION add_code_to_blacklist()
RETURNS TRIGGER AS $$
BEGIN
    -- Add the new code to blacklist
    INSERT INTO used_gift_card_codes (code, qr_code_token, gift_card_id, reason)
    VALUES (NEW.code, NEW.qr_code_token, NEW.id, 'generated')
    ON CONFLICT (code) DO UPDATE SET
        gift_card_id = NEW.id,
        qr_code_token = NEW.qr_code_token;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (drop if exists first)
DROP TRIGGER IF EXISTS blacklist_gift_card_code ON gift_cards;
CREATE TRIGGER blacklist_gift_card_code
    AFTER INSERT ON gift_cards
    FOR EACH ROW
    EXECUTE FUNCTION add_code_to_blacklist();

-- ============================================
-- FUNCTION: Check if code is available
-- Utility function for validation
-- ============================================
CREATE OR REPLACE FUNCTION is_gift_card_code_available(p_code TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN NOT EXISTS (
        SELECT 1 FROM used_gift_card_codes WHERE code = p_code
    ) AND NOT EXISTS (
        SELECT 1 FROM gift_cards WHERE code = p_code
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Reserve a code (for admin use)
-- Blocks a code without creating a gift card
-- ============================================
CREATE OR REPLACE FUNCTION reserve_gift_card_code(p_code TEXT, p_reason TEXT DEFAULT 'reserved')
RETURNS BOOLEAN AS $$
BEGIN
    IF NOT is_gift_card_code_available(p_code) THEN
        RETURN FALSE;
    END IF;
    
    INSERT INTO used_gift_card_codes (code, reason)
    VALUES (p_code, p_reason);
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE used_gift_card_codes ENABLE ROW LEVEL SECURITY;

-- Only admins can view/modify the blacklist
CREATE POLICY "Admins can manage code blacklist"
    ON used_gift_card_codes FOR ALL
    USING (is_admin());

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE used_gift_card_codes IS 'Blacklist of all gift card codes ever generated - prevents code reuse';
COMMENT ON COLUMN used_gift_card_codes.reason IS 'Why code was added: generated, reserved, admin_blocked';
COMMENT ON FUNCTION is_gift_card_code_available IS 'Check if a gift card code can be used';
COMMENT ON FUNCTION reserve_gift_card_code IS 'Reserve/block a code without creating a gift card';
