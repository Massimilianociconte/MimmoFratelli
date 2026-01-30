-- Avenue M. E-commerce Platform
-- Migration 019: Enable RLS on notification_logs table
-- Fixes security advisory: rls_disabled_in_public

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
