-- Avenue M. E-commerce Platform
-- Migration 010: User Settings & Profile Extensions
-- Adds address fields and preferences to profiles table

-- ============================================
-- ADD ADDRESS FIELDS TO PROFILES
-- ============================================
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS zip TEXT,
ADD COLUMN IF NOT EXISTS province TEXT,
ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'IT';

-- ============================================
-- ADD PREFERENCES FIELDS
-- ============================================
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS newsletter BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS order_notifications BOOLEAN DEFAULT true;

-- ============================================
-- CREATE USER_SETTINGS TABLE FOR EXTENDED PREFERENCES
-- ============================================
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setting_key TEXT NOT NULL,
  setting_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, setting_key)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Trigger for updated_at
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- RLS POLICIES FOR USER_SETTINGS
-- ============================================
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Users can only see their own settings
CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own settings
CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own settings
CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own settings
CREATE POLICY "Users can delete own settings"
  ON user_settings FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- FUNCTION TO SYNC PROFILE FROM AUTH METADATA
-- ============================================
CREATE OR REPLACE FUNCTION sync_profile_from_auth()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, first_name, last_name, phone, address, city, zip, province, newsletter, order_notifications)
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data->>'first_name')::TEXT, ''),
    COALESCE((NEW.raw_user_meta_data->>'last_name')::TEXT, ''),
    (NEW.raw_user_meta_data->>'phone')::TEXT,
    (NEW.raw_user_meta_data->>'address')::TEXT,
    (NEW.raw_user_meta_data->>'city')::TEXT,
    (NEW.raw_user_meta_data->>'zip')::TEXT,
    (NEW.raw_user_meta_data->>'province')::TEXT,
    COALESCE((NEW.raw_user_meta_data->>'newsletter')::BOOLEAN, true),
    COALESCE((NEW.raw_user_meta_data->>'order_notifications')::BOOLEAN, true)
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, profiles.last_name),
    phone = COALESCE(EXCLUDED.phone, profiles.phone),
    address = COALESCE(EXCLUDED.address, profiles.address),
    city = COALESCE(EXCLUDED.city, profiles.city),
    zip = COALESCE(EXCLUDED.zip, profiles.zip),
    province = COALESCE(EXCLUDED.province, profiles.province),
    newsletter = COALESCE(EXCLUDED.newsletter, profiles.newsletter),
    order_notifications = COALESCE(EXCLUDED.order_notifications, profiles.order_notifications),
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE user_settings IS 'Extended user settings and preferences';
COMMENT ON COLUMN profiles.address IS 'User shipping address';
COMMENT ON COLUMN profiles.city IS 'User city';
COMMENT ON COLUMN profiles.zip IS 'User postal code';
COMMENT ON COLUMN profiles.province IS 'User province/state';
COMMENT ON COLUMN profiles.newsletter IS 'Newsletter subscription preference';
COMMENT ON COLUMN profiles.order_notifications IS 'Order notification preference';
