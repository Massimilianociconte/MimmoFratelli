-- Avenue M. E-commerce Platform
-- Migration 003: Promotions, Gift Cards, and Audit Log
-- Creates promotions, gift_cards, and audit_log tables

-- ============================================
-- PROMOTIONS TABLE
-- Discount codes and promotional offers
-- ============================================
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL CHECK (discount_value > 0),
  min_purchase DECIMAL(10,2) DEFAULT 0 CHECK (min_purchase >= 0),
  max_discount DECIMAL(10,2), -- Maximum discount amount for percentage discounts
  code TEXT UNIQUE, -- Promo code (optional, null for automatic promotions)
  usage_limit INTEGER, -- Max number of uses (null = unlimited)
  usage_count INTEGER DEFAULT 0,
  applies_to TEXT DEFAULT 'all' CHECK (applies_to IN ('all', 'category', 'product')),
  applies_to_ids UUID[], -- Category or product IDs if applies_to != 'all'
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure end date is after start date
  CONSTRAINT valid_date_range CHECK (ends_at > starts_at)
);

-- Indexes for promotions
CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(is_active);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(starts_at, ends_at);

CREATE TRIGGER update_promotions_updated_at
  BEFORE UPDATE ON promotions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to check if promotion is currently valid
CREATE OR REPLACE FUNCTION is_promotion_valid(promo_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  promo RECORD;
BEGIN
  SELECT * INTO promo FROM promotions WHERE id = promo_id;
  
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  RETURN promo.is_active 
    AND NOW() >= promo.starts_at 
    AND NOW() <= promo.ends_at
    AND (promo.usage_limit IS NULL OR promo.usage_count < promo.usage_limit);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- GIFT CARDS TABLE
-- Purchasable gift cards with unique codes
-- ============================================
CREATE TABLE IF NOT EXISTS gift_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  balance DECIMAL(10,2) NOT NULL CHECK (balance >= 0),
  template_id TEXT DEFAULT 'classic',
  recipient_name TEXT,
  recipient_email TEXT,
  sender_name TEXT,
  message TEXT,
  purchased_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  purchased_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  -- Balance cannot exceed original amount
  CONSTRAINT valid_balance CHECK (balance <= amount)
);

-- Generate unique gift card code
CREATE OR REPLACE FUNCTION generate_gift_card_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Excluding confusing chars
  code TEXT := '';
  i INTEGER;
BEGIN
  -- Format: XXXX-XXXX-XXXX
  FOR i IN 1..12 LOOP
    code := code || SUBSTR(chars, FLOOR(RANDOM() * LENGTH(chars) + 1)::INTEGER, 1);
    IF i IN (4, 8) THEN
      code := code || '-';
    END IF;
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_gift_card_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.code IS NULL THEN
    -- Generate unique code
    LOOP
      NEW.code := generate_gift_card_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM gift_cards WHERE code = NEW.code);
    END LOOP;
  END IF;
  -- Set initial balance equal to amount
  IF NEW.balance IS NULL THEN
    NEW.balance := NEW.amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_gift_card_defaults
  BEFORE INSERT ON gift_cards
  FOR EACH ROW
  EXECUTE FUNCTION set_gift_card_code();

-- Indexes for gift cards
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_purchased_by ON gift_cards(purchased_by);
CREATE INDEX IF NOT EXISTS idx_gift_cards_active ON gift_cards(is_active);

-- ============================================
-- AUDIT LOG TABLE
-- Tracks sensitive operations for security
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log(record_id);

-- Function to create audit log entry
CREATE OR REPLACE FUNCTION create_audit_log(
  p_user_id UUID,
  p_action TEXT,
  p_table_name TEXT,
  p_record_id UUID DEFAULT NULL,
  p_old_data JSONB DEFAULT NULL,
  p_new_data JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (p_user_id, p_action, p_table_name, p_record_id, p_old_data, p_new_data)
  RETURNING id INTO log_id;
  
  RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE promotions IS 'Promotional offers and discount codes';
COMMENT ON TABLE gift_cards IS 'Purchasable gift cards with unique redemption codes';
COMMENT ON TABLE audit_log IS 'Security audit trail for sensitive operations';
COMMENT ON COLUMN gift_cards.code IS 'Unique redemption code (format: XXXX-XXXX-XXXX)';
COMMENT ON COLUMN promotions.applies_to IS 'Scope of promotion: all products, specific category, or specific products';
