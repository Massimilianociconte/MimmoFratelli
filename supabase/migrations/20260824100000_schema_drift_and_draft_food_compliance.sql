-- 1) Schema drift: columns used by admin/admin.js and the storefront that were
-- added manually to the live DB without a migration. Without them, any
-- environment rebuilt from migrations fails on every product save
-- (PGRST204) and the seasonal filter breaks.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_seasonal BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_new BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS page_type TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS search_keywords TEXT;

-- 2) Food-information compliance for the CaricoFacile (gestionale) draft
-- publication flow. The CMS blocks conserve/secchi-estratti products without
-- mandatory food information (Reg. UE 1169/2011), but publish_draft inserted
-- them as active with no food data, bypassing the rule enforced everywhere
-- else. This re-publishes the ORIGINAL function from migration 027 with two
-- targeted changes only:
--   a) food_information_required is set for conserve/secchi-estratti types
--   b) those products are created is_active = false until an admin verifies
--      the mandatory food information in the CMS
DO $outer$
DECLARE
  v_fn_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'publish_draft'
      AND pronamespace = 'public'::regnamespace
  ) INTO v_fn_exists;

  IF v_fn_exists THEN
    EXECUTE $fn$
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
  v_requires_food_info BOOLEAN;
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

  -- Compliance (Reg. UE 1169/2011): conserve and secchi-estratti products
  -- require verified mandatory food information before going live. They are
  -- created inactive with the flag set, mirroring the CMS form rule.
  v_product_type := COALESCE(NULLIF(v_parsed->>'product_type', ''), 'altro');
  v_requires_food_info := v_product_type IN ('conserve', 'secchi-estratti');

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
    food_information_required
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
    NOT v_requires_food_info,
    CASE
      WHEN v_parsed->>'unit_type' = 'piece'
        THEN GREATEST(COALESCE((v_parsed->>'num_items')::INTEGER, 0), 0)
      ELSE NULL
    END,
    CASE WHEN v_parsed->>'unit_type' = 'piece' THEN 'pz' ELSE 'kg' END,
    v_requires_food_info
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
    'slug', v_slug
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
$fn$;
  END IF;
END $outer$;
