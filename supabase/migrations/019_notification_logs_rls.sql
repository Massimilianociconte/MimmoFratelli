-- Avenue M. E-commerce Platform
-- Migration 019: Enable RLS on notification_logs table
-- Fixes security advisory: rls_disabled_in_public

-- ============================================
-- NOTIFICATION LOGS TABLE
-- Definizione difensiva: la tabella era creata manualmente in produzione
-- ma assente dalle migration, quindi ENABLE RLS falliva su DB puliti.
-- ============================================
CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT,
  title TEXT,
  body TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'pending',
  product_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_created ON notification_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_user ON notification_logs(user_id);

-- ============================================
-- NOTIFICATION LOGS TABLE RLS
-- System table for tracking sent notifications
-- Only admins can view, system can insert
-- ============================================
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

-- Admins can view all notification logs
CREATE POLICY "Admins can view notification logs" 
  ON notification_logs FOR SELECT 
  USING (is_admin());

-- Admins can manage notification logs
CREATE POLICY "Admins can manage notification logs" 
  ON notification_logs FOR ALL 
  USING (is_admin());

-- Allow service role to insert notification logs (for edge functions)
CREATE POLICY "Service role can insert notification logs" 
  ON notification_logs FOR INSERT 
  WITH CHECK (true);

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE notification_logs IS 'System table for tracking sent notifications - RLS enabled';
