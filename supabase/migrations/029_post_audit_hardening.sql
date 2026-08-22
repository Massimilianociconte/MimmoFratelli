-- Mimmo Fratelli E-commerce Platform
-- Post-audit hardening (2026-08):
--   1) publish_draft publishes prepackaged food only with the Reg. (UE)
--      1169/2011 flag raised, so checkout stays blocked until a human verifies
--      ingredients/allergens from the producer label;
--   2) orders.status / payment_status accept partial-refund and dispute states
--      so Stripe events can be represented without losing history;
--   3) hourly reconciliation job sweeps paid-but-unfulfilled Stripe sessions.

-- ============================================================
-- 1) publish_draft: compliance etichettatura alimentare
--
-- Il flusso CaricoFacile non acquisisce ingredienti/allergeni. Un prodotto
-- preimballato classificato 'altro' dall'AI sarebbe risultato pubblicato e
-- acquistabile senza informazioni obbligatorie. Inoltre la CHECK
-- products_prepared_food_requires_information rendeva attualmente IMPOSSIBILE
-- pubblicare draft 'conserve'/'secchi-estratti' (insert falliva con
-- invalid_product_data). La funzione aggiornata:
--   - imposta food_information_required = true per i tipi preimballati e per
--     l'ambiguo 'altro', copiando gli eventuali campi alimentari dal parsed;
--   - lascia sempre food_information_verified_at = NULL: la verifica resta umana.
-- Frutta/verdura sfusa non richiede il flag (non preimballata).
-- ============================================================

CREATE OR REPLACE FUNCTION public.publish_draft(p_draft_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.product_drafts%ROWTYPE;
  v_parsed JSONB;
  v_product_id UUID;
  v_category_id UUID;
  v_slug TEXT;
  v_base_slug TEXT;
  v_suffix INTEGER := 1;
  v_weight JSONB;
  v_price_cents INTEGER;
  v_sale_price_cents INTEGER;
  v_images TEXT[];
  v_product_type TEXT;
  v_food_required BOOLEAN;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_admin');
  END IF;

  SELECT *
  INTO v_draft
  FROM public.product_drafts
  WHERE id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF v_draft.status = 'published' THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'product_id', v_draft.published_product_id
    );
  END IF;

  IF v_draft.status <> 'draft' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_publishable');
  END IF;

  v_parsed := v_draft.parsed - 'confidence';

  IF btrim(COALESCE(v_parsed->>'name', '')) = ''
    OR jsonb_typeof(v_parsed->'price') <> 'number'
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_required_fields');
  END IF;

  BEGIN
    v_price_cents := (v_parsed->>'price')::INTEGER;
    v_sale_price_cents := NULLIF(v_parsed->>'sale_price', '')::INTEGER;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_price');
  END;

  IF v_price_cents <= 0
    OR (v_sale_price_cents IS NOT NULL AND (
      v_sale_price_cents <= 0 OR v_sale_price_cents >= v_price_cents
    ))
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_price');
  END IF;

  v_product_type := COALESCE(NULLIF(v_parsed->>'product_type', ''), 'altro');

  -- Tipi preimballati o non classificabili: il checkout resta bloccato finché
  -- un amministratore non verifica le informazioni alimentari dal CMS.
  v_food_required := v_product_type IN ('conserve', 'secchi-estratti', 'altro');

  IF NULLIF(v_parsed->>'category_slug', '') IS NOT NULL THEN
    SELECT id
    INTO v_category_id
    FROM public.categories
    WHERE slug = v_parsed->>'category_slug'
    LIMIT 1;
  END IF;

  v_base_slug := regexp_replace(
    lower(extensions.unaccent(v_parsed->>'name')),
    '[^a-z0-9]+',
    '-',
    'g'
  );
  v_base_slug := trim(BOTH '-' FROM v_base_slug);

  IF v_base_slug = '' THEN
    v_base_slug := 'prodotto-' || substr(p_draft_id::TEXT, 1, 8);
  END IF;

  -- Serialize only equal-base slug generation so concurrent publications cannot
  -- choose the same suffix before the products unique constraint is checked.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_base_slug, 0)
  );

  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM public.products WHERE slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  END LOOP;

  IF jsonb_typeof(v_parsed->'images') = 'array' THEN
    SELECT COALESCE(array_agg(value), ARRAY[]::TEXT[])
    INTO v_images
    FROM jsonb_array_elements_text(v_parsed->'images');
  ELSE
    v_images := ARRAY[]::TEXT[];
  END IF;

  INSERT INTO public.products (
    name,
    slug,
    description,
    price,
    sale_price,
    category_id,
    gender,
    images,
    inventory,
    is_active,
    num_items,
    unit_measure,
    ingredients,
    allergens,
    origin_country,
    storage_instructions,
    net_quantity_label,
    food_operator_name_address,
    usage_instructions,
    nutrition_declaration,
    food_information_required,
    food_information_verified_at
  )
  VALUES (
    btrim(v_parsed->>'name'),
    v_slug,
    NULLIF(btrim(v_parsed->>'description'), ''),
    (v_price_cents::NUMERIC / 100),
    CASE
      WHEN v_sale_price_cents IS NULL THEN NULL
      ELSE (v_sale_price_cents::NUMERIC / 100)
    END,
    v_category_id,
    v_product_type,
    v_images,
    CASE
      WHEN v_parsed->>'unit_type' = 'piece'
        THEN GREATEST(COALESCE((v_parsed->>'num_items')::INTEGER, 0), 0)
      ELSE 0
    END,
    true,
    CASE
      WHEN v_parsed->>'unit_type' = 'piece'
        THEN GREATEST(COALESCE((v_parsed->>'num_items')::INTEGER, 0), 0)
      ELSE NULL
    END,
    CASE WHEN v_parsed->>'unit_type' = 'piece' THEN 'pz' ELSE 'kg' END,
    NULLIF(btrim(COALESCE(v_parsed->>'ingredients', '')), ''),
    NULLIF(btrim(COALESCE(v_parsed->>'allergens', '')), ''),
    NULLIF(btrim(COALESCE(v_parsed->>'origin_country', '')), ''),
    NULLIF(btrim(COALESCE(v_parsed->>'storage_instructions', '')), ''),
    NULLIF(btrim(COALESCE(v_parsed->>'net_quantity_label', '')), ''),
    NULLIF(btrim(COALESCE(v_parsed->>'food_operator_name_address', '')), ''),
    NULLIF(btrim(COALESCE(v_parsed->>'usage_instructions', '')), ''),
    NULLIF(btrim(COALESCE(v_parsed->>'nutrition_declaration', '')), ''),
    v_food_required,
    NULL
  )
  RETURNING id INTO v_product_id;

  IF v_parsed->>'unit_type' = 'weight'
    AND jsonb_typeof(v_parsed->'weights') = 'array'
  THEN
    FOR v_weight IN
      SELECT value
      FROM jsonb_array_elements(v_parsed->'weights')
    LOOP
      IF COALESCE((v_weight->>'grams')::INTEGER, 0) > 0 THEN
        INSERT INTO public.weight_inventory (
          product_id,
          weight_grams,
          quantity,
          variant_name
        )
        VALUES (
          v_product_id,
          (v_weight->>'grams')::INTEGER,
          GREATEST(COALESCE((v_weight->>'qty')::INTEGER, 0), 0),
          NULLIF(btrim(v_weight->>'name'), '')
        )
        ON CONFLICT (product_id, weight_grams)
        DO UPDATE SET
          quantity = EXCLUDED.quantity,
          variant_name = EXCLUDED.variant_name,
          updated_at = now();
      END IF;
    END LOOP;
  END IF;

  UPDATE public.product_drafts
  SET
    status = 'published',
    published_product_id = v_product_id,
    updated_at = now()
  WHERE id = p_draft_id;

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_product_id,
    'slug', v_slug,
    'food_information_required', v_food_required
  );
EXCEPTION
  WHEN check_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_product_data');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_reference');
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_product_data');
END;
$$;

REVOKE ALL ON FUNCTION public.publish_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_draft(UUID) TO authenticated;

COMMENT ON FUNCTION public.publish_draft(UUID) IS
  'Pubblica un draft CaricoFacile. I tipi preimballati (conserve, secchi-estratti) e il tipo ambiguo (altro) nascono con food_information_required=true e verified_at NULL: acquisto online bloccato fino a verifica umana ex Reg. UE 1169/2011.';

-- I draft già pubblicati prima di questa migrazione con tipo preimballato ma
-- senza flag vengono messi in sicurezza (checkout bloccato fino a revisione).
UPDATE public.products p
SET food_information_required = true,
    food_information_verified_at = NULL
FROM public.product_drafts d
WHERE d.published_product_id = p.id
  AND d.status = 'published'
  AND COALESCE(NULLIF(d.parsed->>'product_type', ''), 'altro')
        IN ('conserve', 'secchi-estratti', 'altro')
  AND p.food_information_required = false;

-- Stessa messa in sicurezza per prodotti preimballati creati fuori dal flusso
-- CaricoFacile che siano ancora privi di verifica.
UPDATE public.products
SET food_information_required = true,
    food_information_verified_at = NULL
WHERE gender IN ('conserve', 'secchi-estratti')
  AND food_information_required = false;

-- ============================================================
-- 2) Estensione stati ordine: rimborso parziale e dispute
--
-- Le CHECK originali (migration 002) sono senza nome: i nomi automatici sono
-- orders_status_check / orders_payment_status_check. La migrazione è difensiva
-- ed è idempotente.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_status_check'
  ) THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_status_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_status_check_v2'
  ) THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_status_check_v2
      CHECK (status IN (
        'pending', 'confirmed', 'processing', 'shipped', 'delivered',
        'cancelled', 'refunded', 'partially_refunded', 'disputed'
      ));
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_payment_status_check'
  ) THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_payment_status_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_payment_status_check_v2'
  ) THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check_v2
      CHECK (payment_status IN (
        'pending', 'completed', 'failed', 'refunded', 'partially_refunded'
      ));
  END IF;
END $$;

COMMENT ON CONSTRAINT orders_status_check_v2 ON public.orders IS
  "Aggiunti post-audit: partially_refunded (rimborso parziale Stripe) e disputed (chargeback aperto).";

COMMENT ON CONSTRAINT orders_payment_status_check_v2 ON public.orders IS
  "Aggiunto post-audit: partially_refunded per rimborsi parziali Stripe.";

-- Ordini già rimborsati parzialmente in passato (se esistono) restano coerenti:
-- nessun backfill necessario perché il webhook ora registra il nuovo stato solo
-- per eventi futuri.

-- ============================================================
-- 3) Riconciliazione oraria delle sessioni pagate senza ordine
--
-- Richiede: pg_net attivo + segreti Supabase
--   RECONCILE_SECRET_KEY  (header x-reconcile-key verso la Edge Function)
-- Se pg_net non è abilitato, pianificare esternamente (es. cron esterno,
-- GitHub Actions scheduled workflow) chiamando:
--   POST https://<project>.supabase.co/functions/v1/reconcile-stripe-checkouts
--   header: x-reconcile-key: <RECONCILE_SECRET_KEY>
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) AND EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_net'
  ) THEN
    -- URL pubblico del progetto (già presente in js/config.js).
    DELETE FROM cron.job WHERE jobname = 'reconcile-stripe-checkouts';

    PERFORM cron.schedule(
      'reconcile-stripe-checkouts',
      '17 * * * *',
      $job$
      SELECT net.http_post(
        url := 'https://onvufwqybriaoadsdjyk.supabase.co/functions/v1/reconcile-stripe-checkouts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-reconcile-key', current_setting('app.reconcile_secret_key', true)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
      $job$
    );

    RAISE NOTICE 'Cron reconcile-stripe-checkouts pianificato. Impostare il secret: ALTER DATABASE postgres SET app.reconcile_secret_key = ''<stesso valore del secret Edge RECONCILE_SECRET_KEY>''';
  ELSE
    RAISE NOTICE 'pg_cron o pg_net assenti: schedulare reconcile-stripe-checkouts esternamente.';
  END IF;
END $$;
