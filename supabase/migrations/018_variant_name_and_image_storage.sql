-- Mimmo Fratelli E-commerce Platform
-- Migration 018: Add variant name to weight_inventory and create image storage bucket
-- Allows descriptive names for inventory variants (e.g., "Cassetta fragole 250g")

-- ============================================
-- ADD VARIANT NAME COLUMN
-- ============================================
ALTER TABLE weight_inventory 
ADD COLUMN IF NOT EXISTS variant_name TEXT DEFAULT NULL;

COMMENT ON COLUMN weight_inventory.variant_name IS 'Descriptive name for the variant (e.g., Cassetta fragole 250g)';

-- ============================================
-- CREATE STORAGE BUCKET FOR PRODUCT IMAGES
-- ============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STORAGE POLICIES
-- ============================================

-- Anyone can view product images (public bucket)
CREATE POLICY "Public read access for product images"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- Only admins can upload/update/delete images
CREATE POLICY "Admins can upload product images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'product-images' 
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can update product images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'product-images' 
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can delete product images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'product-images' 
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

