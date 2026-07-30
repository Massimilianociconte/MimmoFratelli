-- Mimmo Fratelli E-commerce Platform
-- Migration 025: Hardening RLS fcm_tokens
-- La migrazione 013 permetteva a chiunque (anon) di leggere/aggiornare tutti i token FCM.
-- Questa migrazione chiude la falla: niente SELECT anonimo, update solo su token propri o non rivendicati.

-- Definizione difensiva della tabella (creata manualmente in produzione, assente dalle migrazioni)
CREATE TABLE IF NOT EXISTS fcm_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user ON fcm_tokens(user_id);

ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;

-- Rimuove le policy permissive della migrazione 013
DROP POLICY IF EXISTS "Anyone can insert fcm tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Anyone can update fcm tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Anyone can select fcm tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Users can delete own fcm tokens" ON fcm_tokens;

-- Rimozione difensiva delle policy di questa migrazione (idempotenza in caso di applicazione manuale pregressa)
DROP POLICY IF EXISTS "fcm_insert_own_or_unclaimed" ON fcm_tokens;
DROP POLICY IF EXISTS "fcm_update_unclaimed_anon" ON fcm_tokens;
DROP POLICY IF EXISTS "fcm_update_authenticated" ON fcm_tokens;
DROP POLICY IF EXISTS "fcm_select_own" ON fcm_tokens;
DROP POLICY IF EXISTS "fcm_delete_own_or_unclaimed" ON fcm_tokens;

-- INSERT: anonimi solo token senza proprietario; autenticati solo a proprio nome
CREATE POLICY "fcm_insert_own_or_unclaimed"
ON fcm_tokens FOR INSERT
TO anon, authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- UPDATE anon: solo token non rivendicati (upsert del proprio token anonimo)
CREATE POLICY "fcm_update_unclaimed_anon"
ON fcm_tokens FOR UPDATE
TO anon
USING (user_id IS NULL)
WITH CHECK (user_id IS NULL);

-- UPDATE authenticated: può rivendicare un token (il valore token è segreto e non enumerabile
-- perché il SELECT è limitato ai propri), ma mai assegnarlo a un altro utente
CREATE POLICY "fcm_update_authenticated"
ON fcm_tokens FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- SELECT: solo i propri token; nessuna lettura anonima
CREATE POLICY "fcm_select_own"
ON fcm_tokens FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- DELETE: i propri token o quelli non rivendicati (disattivazione notifiche da anonimo)
CREATE POLICY "fcm_delete_own_or_unclaimed"
ON fcm_tokens FOR DELETE
TO anon, authenticated
USING (user_id IS NULL OR user_id = auth.uid());

COMMENT ON TABLE fcm_tokens IS 'Token FCM per notifiche push - RLS: nessuna lettura pubblica, update solo su token propri o non rivendicati';
