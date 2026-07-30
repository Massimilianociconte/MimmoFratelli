-- Public buckets already expose object URLs without a broad SELECT policy on
-- storage.objects. Keep uploads readable to tenant admins while preventing
-- anonymous bucket enumeration.

DROP POLICY IF EXISTS "CaricoFacile public product photos" ON storage.objects;
DROP POLICY IF EXISTS "CaricoFacile admin read product photos" ON storage.objects;

CREATE POLICY "CaricoFacile admin read product photos"
  ON storage.objects
  FOR SELECT
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
