-- Mimmo Fratelli E-commerce Platform
-- Migration: push_subscriptions table (definizione difensiva) + preferenza seasonal_notifications
--
-- Contesto: la tabella `push_subscriptions` era referenziata da alcune Edge Function
-- (send-push-notification, delete-account) e dal service legacy Web-Push
-- (js/services/notifications.js), ma non era mai stata definita nelle migration:
-- su DB puliti le query fallivano a runtime. La colonna `profiles.seasonal_notifications`
-- era usata dal frontend e dalle notifiche stagionali senza definizione formale.
-- Definizioni difensive e idempotenti (IF NOT EXISTS) coerenti con le migration 019/025.

-- ============================================
-- PUSH_SUBSCRIPTIONS (Web Push legacy / fallback)
-- ============================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allineamento difensivo: in produzione la tabella era stata creata manualmente
-- con uno schema differente (ad es. senza `is_active`). ADD COLUMN IF NOT EXISTS
-- garantisce la presenza di tutte le colonne sia su DB puliti sia pre-esistenti.
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS endpoint TEXT;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS p256dh TEXT;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS auth TEXT;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Indice unico su endpoint (upsert onConflict: 'endpoint' nel client Web-Push)
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active ON push_subscriptions(is_active);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Rimozione difensiva delle policy (idempotenza in caso di applicazione manuale pregressa)
DROP POLICY IF EXISTS "Users can view own push subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Users can insert own push subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Users can update own push subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Users can delete own push subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Anon can insert push subscriptions" ON push_subscriptions;

-- Un utente autenticato vede/gestisce solo le proprie subscription
CREATE POLICY "Users can view own push subscriptions"
  ON push_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own push subscriptions"
  ON push_subscriptions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own push subscriptions"
  ON push_subscriptions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Insert consentito ad anon e authenticated per iscrizioni Web-Push anonime;
-- gli utenti autenticati possono associare solo il proprio user_id (o lasciarlo NULL).
CREATE POLICY "Anon can insert push subscriptions"
  ON push_subscriptions FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

COMMENT ON TABLE push_subscriptions IS 'Web Push (VAPID) subscriptions - RLS enabled. Definizione difensiva.';

-- ============================================
-- PREFERENZA NOTIFICHE STAGIONALI SU PROFILES
-- ============================================
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS seasonal_notifications BOOLEAN DEFAULT true;

COMMENT ON COLUMN profiles.seasonal_notifications IS 'Preferenza opt-in per le notifiche di prodotti di stagione';
