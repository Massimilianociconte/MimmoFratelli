-- Migration: Fix FCM Tokens RLS Policies
-- Allows anonymous users to save FCM tokens for push notifications

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view own fcm tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Users can insert own fcm tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Users can update own fcm tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Users can delete own fcm tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Anyone can insert fcm tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Anyone can update fcm tokens" ON fcm_tokens;

-- Allow anyone to insert FCM tokens (for anonymous push notifications)
CREATE POLICY "Anyone can insert fcm tokens"
ON fcm_tokens FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Allow anyone to update FCM tokens by token value
CREATE POLICY "Anyone can update fcm tokens"
ON fcm_tokens FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Allow anyone to select FCM tokens (needed for upsert)
CREATE POLICY "Anyone can select fcm tokens"
ON fcm_tokens FOR SELECT
TO anon, authenticated
USING (true);

-- Allow authenticated users to delete their own tokens
CREATE POLICY "Users can delete own fcm tokens"
ON fcm_tokens FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR user_id IS NULL);

-- Add comment
COMMENT ON TABLE fcm_tokens IS 'Firebase Cloud Messaging tokens for push notifications - allows anonymous subscriptions';
