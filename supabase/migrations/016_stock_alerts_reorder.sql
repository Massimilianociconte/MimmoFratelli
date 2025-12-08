-- Migration: Stock Alerts & Reorder Features
-- Adds stock alert subscriptions for out-of-stock products

-- Stock alerts table - users can subscribe to be notified when a product is back in stock
CREATE TABLE IF NOT EXISTS stock_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    email TEXT, -- For non-logged users (optional)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    notified_at TIMESTAMPTZ, -- When the user was notified
    is_active BOOLEAN DEFAULT true,
    UNIQUE(user_id, product_id),
    UNIQUE(email, product_id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_stock_alerts_product ON stock_alerts(product_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_stock_alerts_user ON stock_alerts(user_id) WHERE is_active = true;

-- RLS policies
ALTER TABLE stock_alerts ENABLE ROW LEVEL SECURITY;

-- Users can view their own alerts
CREATE POLICY "Users can view own stock alerts"
    ON stock_alerts FOR SELECT
    USING (auth.uid() = user_id);

-- Users can create alerts for themselves
CREATE POLICY "Users can create stock alerts"
    ON stock_alerts FOR INSERT
    WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Users can delete their own alerts
CREATE POLICY "Users can delete own stock alerts"
    ON stock_alerts FOR DELETE
    USING (auth.uid() = user_id);

-- Users can update their own alerts
CREATE POLICY "Users can update own stock alerts"
    ON stock_alerts FOR UPDATE
    USING (auth.uid() = user_id);

-- Function to check if user has alert for product
CREATE OR REPLACE FUNCTION has_stock_alert(p_product_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM stock_alerts 
        WHERE product_id = p_product_id 
        AND user_id = auth.uid() 
        AND is_active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
