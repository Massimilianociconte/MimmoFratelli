-- Mimmo Fratelli E-commerce Platform
-- Conformità normativa: direttiva Omnibus (UE) 2019/2161 (art. 17-bis
-- d.lgs. 27/2021), Reg. (UE) 1169/2011 art. 14 (vendita a distanza di
-- alimenti preimballati) e consenso marketing opt-in (art. 7 GDPR).

-- ============================================================
-- 1) Reg. (UE) 1169/2011 — informazioni alimentari obbligatorie
--    per i prodotti preimballati, da mostrare prima dell'acquisto
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ingredients TEXT,
  ADD COLUMN IF NOT EXISTS allergens TEXT,
  ADD COLUMN IF NOT EXISTS origin_country TEXT,
  ADD COLUMN IF NOT EXISTS storage_instructions TEXT,
  ADD COLUMN IF NOT EXISTS net_quantity_label TEXT,
  ADD COLUMN IF NOT EXISTS food_operator_name_address TEXT,
  ADD COLUMN IF NOT EXISTS usage_instructions TEXT,
  ADD COLUMN IF NOT EXISTS nutrition_declaration TEXT,
  ADD COLUMN IF NOT EXISTS food_information_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS food_information_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.products.ingredients IS
  'Elenco ingredienti per alimenti preimballati (Reg. UE 1169/2011 art. 14)';
COMMENT ON COLUMN public.products.allergens IS
  'Allergeni ex allegato II Reg. UE 1169/2011, mostrati prima dell''acquisto';
COMMENT ON COLUMN public.products.origin_country IS
  'Paese di origine o luogo di provenienza, ove richiesto';
COMMENT ON COLUMN public.products.storage_instructions IS
  'Condizioni di conservazione e/o d''uso';
COMMENT ON COLUMN public.products.net_quantity_label IS
  'Quantità netta nella forma mostrata al consumatore';
COMMENT ON COLUMN public.products.food_operator_name_address IS
  'Nome o ragione sociale e indirizzo dell''operatore responsabile delle informazioni alimentari';
COMMENT ON COLUMN public.products.usage_instructions IS
  'Istruzioni per l''uso, quando necessarie per un uso adeguato';
COMMENT ON COLUMN public.products.nutrition_declaration IS
  'Dichiarazione nutrizionale o motivazione documentata dell''eventuale esenzione';
COMMENT ON COLUMN public.products.food_information_required IS
  'Se true, il prodotto non è acquistabile online finché le informazioni non sono verificate';
COMMENT ON COLUMN public.products.food_information_verified_at IS
  'Data dell''ultima verifica umana delle informazioni alimentari rispetto a etichetta o scheda del produttore';

-- I prodotti preparati/conservati già presenti richiedono una revisione
-- documentale. Restano visibili, ma il checkout li blocca finché un
-- amministratore non verifica i dati dall'etichetta o dalla scheda produttore.
UPDATE public.products
SET food_information_required = true,
    food_information_verified_at = NULL
WHERE gender IN ('conserve', 'secchi-estratti');

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_verified_food_information_complete,
  ADD CONSTRAINT products_verified_food_information_complete
  CHECK (
    food_information_verified_at IS NULL
    OR (
      food_information_required
      AND NULLIF(BTRIM(ingredients), '') IS NOT NULL
      AND NULLIF(BTRIM(allergens), '') IS NOT NULL
      AND NULLIF(BTRIM(net_quantity_label), '') IS NOT NULL
      AND NULLIF(BTRIM(storage_instructions), '') IS NOT NULL
      AND NULLIF(BTRIM(food_operator_name_address), '') IS NOT NULL
      AND NULLIF(BTRIM(nutrition_declaration), '') IS NOT NULL
    )
  ) NOT VALID,
  DROP CONSTRAINT IF EXISTS products_prepared_food_requires_information,
  ADD CONSTRAINT products_prepared_food_requires_information
  CHECK (
    gender NOT IN ('conserve', 'secchi-estratti')
    OR food_information_required
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_products_food_information_pending
  ON public.products(gender, name)
  WHERE food_information_required
    AND food_information_verified_at IS NULL;

-- ============================================================
-- 2) Direttiva Omnibus — storico prezzi e "prezzo più basso
--    negli ultimi 30 giorni" come riferimento degli sconti
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_price_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL,
  sale_price NUMERIC(10,2),
  effective_price NUMERIC(10,2) GENERATED ALWAYS AS
    (LEAST(price, COALESCE(sale_price, price))) STORED,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_changed
  ON public.product_price_history(product_id, changed_at DESC);

-- RLS attiva ma senza FORCE: i trigger di logging girano come owner
ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;

-- Revoke Supabase's broad defaults before granting read-only access.
-- Writes occur only through the owner-executed SECURITY DEFINER trigger below.
REVOKE ALL ON TABLE public.product_price_history
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.product_price_history TO authenticated;
GRANT SELECT ON TABLE public.product_price_history TO service_role;

REVOKE ALL ON SEQUENCE public.product_price_history_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS "Admins can view price history"
  ON public.product_price_history;
CREATE POLICY "Admins can view price history"
  ON public.product_price_history
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

-- Prezzo di riferimento Omnibus esposto al pubblico insieme al prodotto
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS lowest_price_30d NUMERIC(10,2);

COMMENT ON COLUMN public.products.lowest_price_30d IS
  'Prezzo più basso applicato nei 30 giorni precedenti l''inizio dello sconto (art. 17-bis d.lgs. 27/2021)';

-- Calcola il riferimento Omnibus quando uno sconto inizia o cambia
CREATE OR REPLACE FUNCTION public.set_omnibus_reference_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.sale_price IS NULL OR NEW.price IS NULL
     OR NEW.sale_price >= NEW.price THEN
    -- Nessuna riduzione annunciata: nessun riferimento da esporre
    NEW.lowest_price_30d := NULL;
  ELSIF TG_OP = 'INSERT'
        OR OLD.sale_price IS DISTINCT FROM NEW.sale_price
        OR OLD.price IS DISTINCT FROM NEW.price THEN
    NEW.lowest_price_30d := COALESCE(
      (
        SELECT MIN(effective_price)
        FROM public.product_price_history
        WHERE product_id = NEW.id
          AND changed_at >= NOW() - INTERVAL '30 days'
      ),
      CASE WHEN TG_OP = 'UPDATE'
        THEN LEAST(OLD.price, COALESCE(OLD.sale_price, OLD.price))
        ELSE NEW.price
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_omnibus_reference_price()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_products_omnibus_reference ON public.products;
CREATE TRIGGER trg_products_omnibus_reference
  BEFORE INSERT OR UPDATE OF price, sale_price ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.set_omnibus_reference_price();

-- Registra ogni variazione di prezzo nello storico
CREATE OR REPLACE FUNCTION public.log_product_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR OLD.price IS DISTINCT FROM NEW.price
     OR OLD.sale_price IS DISTINCT FROM NEW.sale_price THEN
    INSERT INTO public.product_price_history (product_id, price, sale_price)
    VALUES (NEW.id, NEW.price, NEW.sale_price);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_product_price_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_products_price_history ON public.products;
CREATE TRIGGER trg_products_price_history
  AFTER INSERT OR UPDATE OF price, sale_price ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.log_product_price_change();

-- Seed: fotografa i prezzi correnti e imposta il riferimento per gli
-- sconti già attivi (il listino corrente è il miglior dato disponibile)
INSERT INTO public.product_price_history (product_id, price, sale_price)
SELECT id, price, sale_price
FROM public.products
WHERE price IS NOT NULL;

UPDATE public.products
SET lowest_price_30d = price
WHERE sale_price IS NOT NULL
  AND price IS NOT NULL
  AND sale_price < price
  AND lowest_price_30d IS NULL;

-- ============================================================
-- 3) GDPR art. 7 — newsletter come consenso opt-in esplicito
-- ============================================================

ALTER TABLE public.profiles
  ALTER COLUMN newsletter SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.sync_profile_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    phone,
    address,
    city,
    zip,
    province,
    newsletter,
    order_notifications
  )
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data->>'first_name')::TEXT, ''),
    COALESCE((NEW.raw_user_meta_data->>'last_name')::TEXT, ''),
    (NEW.raw_user_meta_data->>'phone')::TEXT,
    (NEW.raw_user_meta_data->>'address')::TEXT,
    (NEW.raw_user_meta_data->>'city')::TEXT,
    (NEW.raw_user_meta_data->>'zip')::TEXT,
    (NEW.raw_user_meta_data->>'province')::TEXT,
    COALESCE((NEW.raw_user_meta_data->>'newsletter')::BOOLEAN, false),
    COALESCE((NEW.raw_user_meta_data->>'order_notifications')::BOOLEAN, true)
  )
  ON CONFLICT (id) DO UPDATE
  SET
    first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.profiles.last_name),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    address = COALESCE(EXCLUDED.address, public.profiles.address),
    city = COALESCE(EXCLUDED.city, public.profiles.city),
    zip = COALESCE(EXCLUDED.zip, public.profiles.zip),
    province = COALESCE(EXCLUDED.province, public.profiles.province),
    newsletter = COALESCE(EXCLUDED.newsletter, public.profiles.newsletter),
    order_notifications = COALESCE(
      EXCLUDED.order_notifications,
      public.profiles.order_notifications
    ),
    updated_at = NOW();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_from_auth()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.sync_profile_from_auth() IS
  'Sync profilo da auth.users; newsletter è opt-in esplicito (default false, art. 7 GDPR)';
