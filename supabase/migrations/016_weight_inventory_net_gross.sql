-- Mimmo Fratelli E-commerce Platform
-- Migration 016: Add net/gross weight per variant to weight_inventory
-- Adds per-variant net and gross weight tracking

-- Add net_weight_grams column if not exists
ALTER TABLE weight_inventory 
ADD COLUMN IF NOT EXISTS net_weight_grams INTEGER DEFAULT NULL;

-- Add gross_weight_grams column if not exists
ALTER TABLE weight_inventory 
ADD COLUMN IF NOT EXISTS gross_weight_grams INTEGER DEFAULT NULL;

-- Comments
COMMENT ON COLUMN weight_inventory.net_weight_grams IS 'Net weight per variant in grams (optional)';
COMMENT ON COLUMN weight_inventory.gross_weight_grams IS 'Gross weight per variant in grams (optional)';
