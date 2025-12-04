-- Avenue M. E-commerce Platform
-- Migration 004: Row Level Security Policies
-- Implements RLS for all tables as per Requirements 12.4, 12.5, 6.1, 6.6

-- ============================================
-- HELPER FUNCTION: Check if user is admin
-- ============================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PROFILES TABLE RLS
-- Users can only access their own profile
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" 
  ON profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" 
  ON profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
  ON profiles FOR UPDATE 
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" 
  ON profiles FOR SELECT 
  USING (is_admin());

-- ============================================
-- USER ROLES TABLE RLS
-- Only admins can manage roles
-- ============================================
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own roles" 
  ON user_roles FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all roles" 
  ON user_roles FOR ALL 
  USING (is_admin());

-- ============================================
-- CATEGORIES TABLE RLS
-- Anyone can read active categories, only admins can modify
-- ============================================
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active categories" 
  ON categories FOR SELECT 
  USING (is_active = true);

CREATE POLICY "Admins can view all categories" 
  ON categories FOR SELECT 
  USING (is_admin());

CREATE POLICY "Admins can insert categories" 
  ON categories FOR INSERT 
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update categories" 
  ON categories FOR UPDATE 
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete categories" 
  ON categories FOR DELETE 
  USING (is_admin());

-- ============================================
-- PRODUCTS TABLE RLS
-- Anyone can read active products, only admins can modify
-- ============================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active products" 
  ON products FOR SELECT 
  USING (is_active = true);

CREATE POLICY "Admins can view all products" 
  ON products FOR SELECT 
  USING (is_admin());

CREATE POLICY "Admins can insert products" 
  ON products FOR INSERT 
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update products" 
  ON products FOR UPDATE 
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete products" 
  ON products FOR DELETE 
  USING (is_admin());

-- ============================================
-- WISHLIST ITEMS TABLE RLS
-- Users can only access their own wishlist
-- ============================================
ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wishlist" 
  ON wishlist_items FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add to own wishlist" 
  ON wishlist_items FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove from own wishlist" 
  ON wishlist_items FOR DELETE 
  USING (auth.uid() = user_id);

-- ============================================
-- CART ITEMS TABLE RLS
-- Users can only access their own cart
-- ============================================
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cart" 
  ON cart_items FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add to own cart" 
  ON cart_items FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cart" 
  ON cart_items FOR UPDATE 
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove from own cart" 
  ON cart_items FOR DELETE 
  USING (auth.uid() = user_id);

-- ============================================
-- ORDERS TABLE RLS
-- Users can view their own orders, admins can view all
-- ============================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own orders" 
  ON orders FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own orders" 
  ON orders FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all orders" 
  ON orders FOR SELECT 
  USING (is_admin());

CREATE POLICY "Admins can update orders" 
  ON orders FOR UPDATE 
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================
-- ORDER ITEMS TABLE RLS
-- Users can view items from their own orders
-- ============================================
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own order items" 
  ON order_items FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM orders 
      WHERE orders.id = order_items.order_id 
      AND orders.user_id = auth.uid()
    )
  );

CREATE POLICY "System can insert order items" 
  ON order_items FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM orders 
      WHERE orders.id = order_items.order_id 
      AND orders.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all order items" 
  ON order_items FOR SELECT 
  USING (is_admin());

-- ============================================
-- PROMOTIONS TABLE RLS
-- Anyone can view active promotions, only admins can modify
-- ============================================
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active promotions" 
  ON promotions FOR SELECT 
  USING (is_active = true AND NOW() BETWEEN starts_at AND ends_at);

CREATE POLICY "Admins can view all promotions" 
  ON promotions FOR SELECT 
  USING (is_admin());

CREATE POLICY "Admins can manage promotions" 
  ON promotions FOR ALL 
  USING (is_admin());

-- ============================================
-- GIFT CARDS TABLE RLS
-- Users can view their purchased cards, admins can view all
-- ============================================
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own gift cards" 
  ON gift_cards FOR SELECT 
  USING (auth.uid() = purchased_by);

CREATE POLICY "Authenticated users can validate gift cards" 
  ON gift_cards FOR SELECT 
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage gift cards" 
  ON gift_cards FOR ALL 
  USING (is_admin());

-- ============================================
-- AUDIT LOG TABLE RLS
-- Only admins can view audit logs
-- ============================================
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs" 
  ON audit_log FOR SELECT 
  USING (is_admin());

CREATE POLICY "System can insert audit logs" 
  ON audit_log FOR INSERT 
  WITH CHECK (true); -- Allow inserts from triggers/functions

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON FUNCTION is_admin() IS 'Helper function to check if current user has admin role';
