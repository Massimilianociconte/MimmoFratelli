-- Avenue M. E-commerce Platform
-- Migration 005: Admin Policies for CMS
-- Allows admins to manage products and categories

-- ============================================
-- UPDATE PRODUCTS POLICIES
-- Add UPDATE policy for admins
-- ============================================

-- Drop existing admin policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Admins can update products" ON products;
DROP POLICY IF EXISTS "Admins can delete products" ON products;

-- Recreate with proper permissions
CREATE POLICY "Admins can update products" 
  ON products FOR UPDATE 
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete products" 
  ON products FOR DELETE 
  USING (is_admin());

-- ============================================
-- UPDATE CATEGORIES POLICIES  
-- Add UPDATE and DELETE policies for admins
-- ============================================

DROP POLICY IF EXISTS "Admins can update categories" ON categories;
DROP POLICY IF EXISTS "Admins can delete categories" ON categories;

CREATE POLICY "Admins can update categories" 
  ON categories FOR UPDATE 
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete categories" 
  ON categories FOR DELETE 
  USING (is_admin());

-- ============================================
-- HELPER: Create first admin user
-- Run this manually to create your first admin
-- Replace 'your-user-id' with actual user UUID
-- ============================================

-- Example (uncomment and modify):
-- INSERT INTO user_roles (user_id, role) 
-- VALUES ('your-user-id-here', 'admin')
-- ON CONFLICT (user_id, role) DO NOTHING;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON POLICY "Admins can update products" ON products IS 'Allows admin users to update any product';
COMMENT ON POLICY "Admins can delete products" ON products IS 'Allows admin users to delete any product';
COMMENT ON POLICY "Admins can update categories" ON categories IS 'Allows admin users to update any category';
COMMENT ON POLICY "Admins can delete categories" ON categories IS 'Allows admin users to delete any category';
