-- Migration: Update product types and add new categories
-- Date: 2025-12-08
-- Description: Replace "Gastronomia" and "I Nostri Preparati" with "Conserve e Preparati" and "Prodotti Secchi e Estratti"
--              Add new subcategories for all macro-categories

-- Step 1: Drop the old constraint first
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_gender_check;

-- Step 2: Migrate existing products from old types to new types
UPDATE products SET gender = 'conserve' WHERE gender = 'gastronomia';
UPDATE products SET gender = 'secchi-estratti' WHERE gender = 'preparati';

-- Step 3: Add the new constraint with updated values
ALTER TABLE products ADD CONSTRAINT products_gender_check 
  CHECK (gender IS NULL OR (gender = ANY (ARRAY['frutta'::text, 'verdura'::text, 'altro'::text, 'conserve'::text, 'secchi-estratti'::text])));

-- Step 4: Insert new categories for Frutta (including Frutta Secca and Frutta Disidratata)
INSERT INTO categories (id, name, slug, description, display_order, is_active) VALUES
  ('a1000011-0000-0000-0000-000000000011', 'Frutta Secca', 'frutta-secca', 'Noci, mandorle, nocciole e altra frutta secca', 11, true),
  ('a1000012-0000-0000-0000-000000000012', 'Frutta Disidratata', 'frutta-disidratata', 'Frutta essiccata e disidratata', 12, true),
  ('a1000013-0000-0000-0000-000000000013', 'Frutta Esotica', 'frutta-esotica', 'Frutta tropicale ed esotica', 13, true),
  ('a1000014-0000-0000-0000-000000000014', 'Frutta Biologica', 'frutta-biologica', 'Frutta da agricoltura biologica certificata', 14, true)
ON CONFLICT (slug) DO NOTHING;

-- Step 5: Insert new categories for Verdura
INSERT INTO categories (id, name, slug, description, display_order, is_active) VALUES
  ('a1000015-0000-0000-0000-000000000015', 'Ortaggi', 'ortaggi', 'Ortaggi freschi di stagione', 15, true),
  ('a1000016-0000-0000-0000-000000000016', 'Insalate', 'insalate', 'Insalate fresche e miste', 16, true),
  ('a1000017-0000-0000-0000-000000000017', 'Verdura Biologica', 'verdura-biologica', 'Verdura da agricoltura biologica certificata', 17, true),
  ('a1000018-0000-0000-0000-000000000018', 'Legumi Freschi', 'legumi-freschi', 'Legumi freschi di stagione', 18, true),
  ('a1000019-0000-0000-0000-000000000019', 'Erbe Aromatiche', 'erbe-aromatiche', 'Erbe aromatiche fresche', 19, true)
ON CONFLICT (slug) DO NOTHING;

-- Step 6: Insert new categories for Conserve e Preparati
INSERT INTO categories (id, name, slug, description, display_order, is_active) VALUES
  ('a1000020-0000-0000-0000-000000000020', 'Sott''oli', 'sottoli', 'Conserve sott''olio artigianali', 20, true),
  ('a1000021-0000-0000-0000-000000000021', 'Sott''aceti', 'sottaceti', 'Conserve sott''aceto', 21, true),
  ('a1000022-0000-0000-0000-000000000022', 'Marmellate e Confetture', 'marmellate-confetture', 'Marmellate e confetture artigianali', 22, true),
  ('a1000023-0000-0000-0000-000000000023', 'Salse e Sughi', 'salse-sughi', 'Salse, sughi e condimenti pronti', 23, true),
  ('a1000024-0000-0000-0000-000000000024', 'Conserve di Pomodoro', 'conserve-pomodoro', 'Passate, pelati e conserve di pomodoro', 24, true)
ON CONFLICT (slug) DO NOTHING;

-- Step 7: Insert new categories for Prodotti Secchi e Estratti
INSERT INTO categories (id, name, slug, description, display_order, is_active) VALUES
  ('a1000025-0000-0000-0000-000000000025', 'Oli', 'oli', 'Oli extravergine e oli aromatizzati', 25, true),
  ('a1000026-0000-0000-0000-000000000026', 'Succhi e Spremute', 'succhi-spremute', 'Succhi di frutta e spremute fresche', 26, true),
  ('a1000027-0000-0000-0000-000000000027', 'Legumi Secchi', 'legumi-secchi', 'Legumi secchi e cereali', 27, true),
  ('a1000028-0000-0000-0000-000000000028', 'Spezie e Aromi', 'spezie-aromi', 'Spezie, aromi e condimenti secchi', 28, true),
  ('a1000029-0000-0000-0000-000000000029', 'Farine e Cereali', 'farine-cereali', 'Farine, cereali e prodotti da forno', 29, true)
ON CONFLICT (slug) DO NOTHING;

-- CATEGORY MAPPING REFERENCE:
-- 
-- FRUTTA (gender = 'frutta'):
--   - Frutta Fresca (existing)
--   - Agrumi (existing)
--   - Frutta Secca (NEW)
--   - Frutta Disidratata (NEW)
--   - Frutta Esotica (NEW)
--   - Frutta Biologica (NEW)
--
-- VERDURA (gender = 'verdura'):
--   - Verdura Fresca (existing)
--   - Ortaggi (NEW)
--   - Insalate (NEW)
--   - Verdura Biologica (NEW)
--   - Legumi Freschi (NEW)
--   - Erbe Aromatiche (NEW)
--
-- CONSERVE E PREPARATI (gender = 'conserve'):
--   - Sott'oli (NEW)
--   - Sott'aceti (NEW)
--   - Marmellate e Confetture (NEW)
--   - Salse e Sughi (NEW)
--   - Conserve di Pomodoro (NEW)
--
-- PRODOTTI SECCHI E ESTRATTI (gender = 'secchi-estratti'):
--   - Oli (NEW)
--   - Succhi e Spremute (NEW)
--   - Legumi Secchi (NEW)
--   - Spezie e Aromi (NEW)
--   - Farine e Cereali (NEW)
