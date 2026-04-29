-- Mimmo Fratelli E-commerce Platform
-- Migration 022: Stripe idempotency and pending checkout snapshots
-- Safe to run after 021. It does not delete orders; duplicate payment IDs are preserved in notes
-- and cleared only on secondary rows so the unique payment_id guard can be enforced.

-- Existing production data contains at least one duplicated Stripe payment_id.
-- Keep the strongest order as canonical: completed payment, more order items, highest total, then oldest.
WITH order_item_counts AS (
  SELECT order_id, COUNT(*) AS item_count
  FROM order_items
  GROUP BY order_id
),
ranked_duplicate_orders AS (
  SELECT
    o.id,
    o.payment_id,
    ROW_NUMBER() OVER (
      PARTITION BY o.payment_id
      ORDER BY
        (o.payment_status = 'completed') DESC,
        COALESCE(oi.item_count, 0) DESC,
        o.total DESC,
        o.created_at ASC NULLS LAST,
        o.id ASC
    ) AS duplicate_rank
  FROM orders o
  LEFT JOIN order_item_counts oi ON oi.order_id = o.id
  WHERE o.payment_id IS NOT NULL
),
cleared_duplicates AS (
  UPDATE orders o
  SET
    notes = CONCAT_WS(
      E'\n',
      NULLIF(o.notes, ''),
      '[Migration 022] Duplicate Stripe payment_id preserved in note and cleared from this secondary order: ' || o.payment_id
    ),
    payment_id = NULL,
    updated_at = NOW()
  FROM ranked_duplicate_orders r
  WHERE o.id = r.id
    AND r.duplicate_rank > 1
  RETURNING o.id
)
SELECT COUNT(*) AS duplicate_orders_cleared FROM cleared_duplicates;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_payment_id
  ON orders(payment_id)
  WHERE payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  stripe_created TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status
  ON stripe_webhook_events(status, created_at DESC);

CREATE TABLE IF NOT EXISTS pending_checkout_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stripe_session_id TEXT UNIQUE NOT NULL,
  stripe_payment_id TEXT UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  checkout_type TEXT NOT NULL DEFAULT 'order'
    CHECK (checkout_type IN ('order', 'gift_card')),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'completed', 'expired', 'cancelled')),
  customer_email TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  shipping_address JSONB,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  gift_card_amount DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (gift_card_amount >= 0),
  user_credit_amount DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (user_credit_amount >= 0),
  shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  total DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  promotion_code TEXT,
  gift_card_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_checkout_sessions_user
  ON pending_checkout_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_checkout_sessions_status
  ON pending_checkout_sessions(status, created_at DESC);

ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_checkout_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view stripe webhook events" ON stripe_webhook_events;
CREATE POLICY "Admins can view stripe webhook events"
  ON stripe_webhook_events FOR SELECT
  USING (is_admin());

DROP POLICY IF EXISTS "Users can view own pending checkout sessions" ON pending_checkout_sessions;
CREATE POLICY "Users can view own pending checkout sessions"
  ON pending_checkout_sessions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view pending checkout sessions" ON pending_checkout_sessions;
CREATE POLICY "Admins can view pending checkout sessions"
  ON pending_checkout_sessions FOR SELECT
  USING (is_admin());
