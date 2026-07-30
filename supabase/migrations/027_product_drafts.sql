-- Mimmo Fratelli / CaricoFacile
-- Migration 027: offline-capable product drafts and transactional publication.
--
-- IMPORTANT:
--   This file is prepared for the current Mimmo schema, but must not be applied
--   to production without an explicit approval and a database backup.
--
-- Canonical draft prices are integer euro cents. products.price and
-- products.sale_price are DECIMAL(10,2), so publish_draft converts cents to euro.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.product_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL
    CHECK (source IN ('photo', 'voice', 'file', 'barcode', 'manual')),
  raw_input JSONB,
  parsed JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'discarded')),
  published_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_drafts_status_created
  ON public.product_drafts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_drafts_created_by
  ON public.product_drafts(created_by);

CREATE INDEX IF NOT EXISTS idx_product_drafts_published_product
  ON public.product_drafts(published_product_id)
  WHERE published_product_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_product_drafts_updated_at ON public.product_drafts;
CREATE TRIGGER update_product_drafts_updated_at
  BEFORE UPDATE ON public.product_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.product_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drafts_admin_all ON public.product_drafts;
CREATE POLICY drafts_admin_all
  ON public.product_drafts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles AS ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role = 'admin'
    )
  )
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.user_roles AS ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role = 'admin'
    )
  );

REVOKE ALL ON TABLE public.product_drafts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_drafts TO authenticated;

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
    unit_measure
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
    COALESCE(NULLIF(v_parsed->>'product_type', ''), 'altro'),
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
    CASE WHEN v_parsed->>'unit_type' = 'piece' THEN 'pz' ELSE 'kg' END
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

REVOKE ALL ON FUNCTION public.publish_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_draft(UUID) TO authenticated;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'product-photos',
  'product-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "CaricoFacile public product photos" ON storage.objects;
CREATE POLICY "CaricoFacile public product photos"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'product-photos');

DROP POLICY IF EXISTS "CaricoFacile admin upload product photos" ON storage.objects;
CREATE POLICY "CaricoFacile admin upload product photos"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-photos'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "CaricoFacile admin update product photos" ON storage.objects;
CREATE POLICY "CaricoFacile admin update product photos"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'product-photos'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role = 'admin'
    )
  )
  WITH CHECK (
    bucket_id = 'product-photos'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "CaricoFacile admin delete product photos" ON storage.objects;
CREATE POLICY "CaricoFacile admin delete product photos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-photos'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = (SELECT auth.uid())
        AND role = 'admin'
    )
  );

COMMENT ON TABLE public.product_drafts IS
  'CaricoFacile product intake drafts. The parsed price values are integer euro cents.';

COMMENT ON FUNCTION public.publish_draft(UUID) IS
  'Admin-only idempotent publication of one CaricoFacile draft into products and weight_inventory.';
