-- Avenue M. E-commerce Platform
-- Migration 006: Size Inventory
-- Adds size_inventory JSONB field to track quantity per size

-- Add size_inventory column to products
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS size_inventory JSONB DEFAULT '{}';

-- Example structure: {"XS": 5, "S": 10, "M": 15, "L": 8, "XL": 3}

-- Comment
COMMENT ON COLUMN products.size_inventory IS 'JSON object mapping size to available quantity, e.g. {"S": 10, "M": 5}';
