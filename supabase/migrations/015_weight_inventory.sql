-- Mimmo Fratelli E-commerce Platform
-- Migration 015: Weight-based Inventory System
-- Replaces size-based inventory with weight/quantity inventory for food products

-- ============================================
-- ADD NEW INVENTORY COLUMNS TO PRODUCTS
-- ============================================

-- Number of crates/boxes (optional)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS num_crates INTEGER DEFAULT NULL;

-- Weight per unit in grams (required for weight-based products)
-- Stored in grams for precision, displayed in kg/g or liters
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS unit_weight_grams INTEGER DEFAULT NULL;

-- Unit of measure: 'kg' (default), 'g', 'l' (liters), 'ml', 'pz' (pieces)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS unit_measure TEXT DEFAULT 'kg' 
CHECK (unit_measure IN ('kg', 'g', 'l', 'ml', 'pz'));

-- Number of individual items (for countable products)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS num_items INTEGER DEFAULT NULL;

-- Net weight in grams (optional)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS net_weight_grams INTEGER DEFAULT NULL;

-- Gross weight in grams (optional)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS gross_weight_grams INTEGER DEFAULT NULL;

-- Weight step for selector (in grams, default 250g)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS weight_step_grams INTEGER DEFAULT 250;

-- ============================================
-- WEIGHT INVENTORY TABLE
-- Tracks available quantities per weight option
-- ============================================
CREATE TABLE IF NOT EXISTS weight_inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  weight_grams INTEGER NOT NULL, -- Weight option in grams
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  net_weight_grams INTEGER DEFAULT NULL, -- Net weight per variant in grams
  gross_weight_grams INTEGER DEFAULT NULL, -- Gross weight per variant in grams
  is_available BOOLEAN GENERATED ALWAYS AS (quantity > 0) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, weight_grams)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_weight_inventory_product ON weight_inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_weight_inventory_available ON weight_inventory(product_id, is_available);

-- Update trigger
CREATE TRIGGER update_weight_inventory_updated_at
  BEFORE UPDATE ON weight_inventory
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- FUNCTION: Update product availability based on inventory
-- ============================================
CREATE OR REPLACE FUNCTION update_product_availability()
RETURNS TRIGGER AS $$
DECLARE
  total_qty INTEGER;
  has_available BOOLEAN;
BEGIN
  -- Calculate total inventory for the product
  SELECT 
    COALESCE(SUM(quantity), 0),
    COALESCE(bool_or(quantity > 0), false)
  INTO total_qty, has_available
  FROM weight_inventory
  WHERE product_id = COALESCE(NEW.product_id, OLD.product_id);
  
  -- Update product inventory count and availability
  UPDATE products
  SET 
    inventory = total_qty,
    is_active = CASE 
      WHEN has_available THEN is_active -- Keep current status if has stock
      ELSE false -- Set inactive if no stock
    END
  WHERE id = COALESCE(NEW.product_id, OLD.product_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update product availability
CREATE TRIGGER trigger_update_product_availability
  AFTER INSERT OR UPDATE OR DELETE ON weight_inventory
  FOR EACH ROW
  EXECUTE FUNCTION update_product_availability();

-- ============================================
-- FUNCTION: Get available weights for a product
-- ============================================
CREATE OR REPLACE FUNCTION get_available_weights(p_product_id UUID)
RETURNS TABLE (
  weight_grams INTEGER,
  quantity INTEGER,
  is_available BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    wi.weight_grams,
    wi.quantity,
    wi.is_available
  FROM weight_inventory wi
  WHERE wi.product_id = p_product_id
  ORDER BY wi.weight_grams;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Check and reserve inventory
-- Returns true if reservation successful
-- ============================================
CREATE OR REPLACE FUNCTION reserve_weight_inventory(
  p_product_id UUID,
  p_weight_grams INTEGER,
  p_quantity INTEGER DEFAULT 1
)
RETURNS BOOLEAN AS $$
DECLARE
  available_qty INTEGER;
BEGIN
  -- Lock the row and get current quantity
  SELECT quantity INTO available_qty
  FROM weight_inventory
  WHERE product_id = p_product_id AND weight_grams = p_weight_grams
  FOR UPDATE;
  
  IF available_qty IS NULL OR available_qty < p_quantity THEN
    RETURN false;
  END IF;
  
  -- Decrement inventory
  UPDATE weight_inventory
  SET quantity = quantity - p_quantity
  WHERE product_id = p_product_id AND weight_grams = p_weight_grams;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Release reserved inventory (for cancelled orders)
-- ============================================
CREATE OR REPLACE FUNCTION release_weight_inventory(
  p_product_id UUID,
  p_weight_grams INTEGER,
  p_quantity INTEGER DEFAULT 1
)
RETURNS VOID AS $$
BEGIN
  UPDATE weight_inventory
  SET quantity = quantity + p_quantity
  WHERE product_id = p_product_id AND weight_grams = p_weight_grams;
  
  -- If no row exists, create one
  IF NOT FOUND THEN
    INSERT INTO weight_inventory (product_id, weight_grams, quantity)
    VALUES (p_product_id, p_weight_grams, p_quantity);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- UPDATE CART_ITEMS FOR WEIGHT-BASED PRODUCTS
-- ============================================
ALTER TABLE cart_items
ADD COLUMN IF NOT EXISTS weight_grams INTEGER DEFAULT NULL;

-- Update unique constraint to include weight
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_id_product_id_size_color_key;
ALTER TABLE cart_items ADD CONSTRAINT cart_items_unique_item 
  UNIQUE(user_id, product_id, size, color, weight_grams);

-- ============================================
-- UPDATE ORDER_ITEMS FOR WEIGHT-BASED PRODUCTS
-- ============================================
ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS weight_grams INTEGER DEFAULT NULL;

ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS unit_measure TEXT DEFAULT 'kg';

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE weight_inventory IS 'Inventory tracking per weight option for food products';
COMMENT ON COLUMN products.num_crates IS 'Number of crates/boxes available (optional)';
COMMENT ON COLUMN products.unit_weight_grams IS 'Standard weight per unit in grams';
COMMENT ON COLUMN products.unit_measure IS 'Unit of measure: kg, g, l (liters), ml, pz (pieces)';
COMMENT ON COLUMN products.num_items IS 'Number of individual countable items';
COMMENT ON COLUMN products.net_weight_grams IS 'Net weight in grams (optional)';
COMMENT ON COLUMN products.gross_weight_grams IS 'Gross weight in grams (optional)';
COMMENT ON COLUMN products.weight_step_grams IS 'Weight increment step for selector (default 250g)';
COMMENT ON COLUMN cart_items.weight_grams IS 'Selected weight in grams for weight-based products';
COMMENT ON COLUMN order_items.weight_grams IS 'Weight in grams at time of purchase';
COMMENT ON COLUMN order_items.unit_measure IS 'Unit of measure at time of purchase';

-- ============================================
-- RLS POLICIES FOR WEIGHT_INVENTORY
-- ============================================
ALTER TABLE weight_inventory ENABLE ROW LEVEL SECURITY;

-- Everyone can read inventory
CREATE POLICY "Anyone can view weight inventory"
  ON weight_inventory FOR SELECT
  USING (true);

-- Only admins can modify inventory
CREATE POLICY "Admins can manage weight inventory"
  ON weight_inventory FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
