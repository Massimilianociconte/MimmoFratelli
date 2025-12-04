-- User Presence and Analytics for Avenue M.
-- Tracks active users and provides user count functions

-- Table to track user presence (active users)
CREATE TABLE IF NOT EXISTS user_presence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    page_url TEXT,
    user_agent TEXT,
    is_authenticated BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen ON user_presence(last_seen);
CREATE INDEX IF NOT EXISTS idx_user_presence_session ON user_presence(session_id);

-- Enable RLS
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert/update their own presence
CREATE POLICY "Users can manage their presence" ON user_presence
    FOR ALL USING (true) WITH CHECK (true);

-- Function to get total registered users count
CREATE OR REPLACE FUNCTION get_users_count()
RETURNS INTEGER AS $$
DECLARE
    user_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM auth.users;
    RETURN user_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active users (seen in last 5 minutes)
CREATE OR REPLACE FUNCTION get_active_users_count()
RETURNS INTEGER AS $$
DECLARE
    active_count INTEGER;
BEGIN
    SELECT COUNT(DISTINCT session_id) INTO active_count 
    FROM user_presence 
    WHERE last_seen > NOW() - INTERVAL '5 minutes';
    RETURN active_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active users list
CREATE OR REPLACE FUNCTION get_active_users()
RETURNS TABLE (
    session_id TEXT,
    user_id UUID,
    last_seen TIMESTAMPTZ,
    page_url TEXT,
    is_authenticated BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (p.session_id)
        p.session_id,
        p.user_id,
        p.last_seen,
        p.page_url,
        p.is_authenticated
    FROM user_presence p
    WHERE p.last_seen > NOW() - INTERVAL '5 minutes'
    ORDER BY p.session_id, p.last_seen DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update user presence (upsert)
CREATE OR REPLACE FUNCTION update_user_presence(
    p_session_id TEXT,
    p_user_id UUID DEFAULT NULL,
    p_page_url TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_is_authenticated BOOLEAN DEFAULT false
)
RETURNS void AS $$
BEGIN
    INSERT INTO user_presence (session_id, user_id, page_url, user_agent, is_authenticated, last_seen)
    VALUES (p_session_id, p_user_id, p_page_url, p_user_agent, p_is_authenticated, NOW())
    ON CONFLICT (session_id) 
    DO UPDATE SET 
        user_id = COALESCE(EXCLUDED.user_id, user_presence.user_id),
        page_url = EXCLUDED.page_url,
        last_seen = NOW(),
        is_authenticated = EXCLUDED.is_authenticated;
EXCEPTION WHEN unique_violation THEN
    UPDATE user_presence 
    SET last_seen = NOW(), 
        page_url = p_page_url,
        is_authenticated = p_is_authenticated
    WHERE session_id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add unique constraint on session_id
ALTER TABLE user_presence ADD CONSTRAINT user_presence_session_unique UNIQUE (session_id);

-- Function to get new users count by period
CREATE OR REPLACE FUNCTION get_new_users_count(period TEXT)
RETURNS INTEGER AS $$
DECLARE
    user_count INTEGER;
    start_date TIMESTAMPTZ;
BEGIN
    CASE period
        WHEN 'today' THEN start_date := DATE_TRUNC('day', NOW());
        WHEN 'week' THEN start_date := DATE_TRUNC('week', NOW());
        WHEN 'month' THEN start_date := DATE_TRUNC('month', NOW());
        ELSE start_date := DATE_TRUNC('day', NOW());
    END CASE;
    
    SELECT COUNT(*) INTO user_count 
    FROM auth.users 
    WHERE created_at >= start_date;
    
    RETURN user_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get total revenue
CREATE OR REPLACE FUNCTION get_total_revenue()
RETURNS DECIMAL AS $$
DECLARE
    total DECIMAL;
BEGIN
    SELECT COALESCE(SUM(total_amount), 0) INTO total 
    FROM orders 
    WHERE status NOT IN ('cancelled', 'refunded');
    RETURN total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cleanup old presence records (run periodically)
CREATE OR REPLACE FUNCTION cleanup_old_presence()
RETURNS void AS $$
BEGIN
    DELETE FROM user_presence WHERE last_seen < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
