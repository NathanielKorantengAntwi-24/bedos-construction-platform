BEGIN;
LOCK TABLE public.property_images,public.property_floor_plans,public.property_features,public.property_amenities IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF to_regprocedure('public.bedos_media_finalize(uuid,uuid,integer,uuid)') IS NULL THEN RAISE EXCEPTION 'Media functions must be installed first';END IF;
 IF (SELECT count(*) FROM storage.buckets WHERE id IN ('property-images','property-floor-plans') AND NOT public)<>2 THEN RAISE EXCEPTION 'Expected private property buckets';END IF;
 IF EXISTS(SELECT 1 FROM public.property_images m WHERE NOT EXISTS(SELECT 1 FROM public.property_media_operations o WHERE o.media_id=m.id AND o.property_id=m.property_id AND o.kind='images' AND o.storage_path=m.storage_path AND o.state IN ('ready','cleanup_pending'))) OR
    EXISTS(SELECT 1 FROM public.property_floor_plans m WHERE NOT EXISTS(SELECT 1 FROM public.property_media_operations o WHERE o.media_id=m.id AND o.property_id=m.property_id AND o.kind='floor_plans' AND o.storage_path=m.storage_path AND o.state IN ('ready','cleanup_pending'))) OR
    EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id IN ('property-images','property-floor-plans') AND NOT EXISTS(SELECT 1 FROM public.property_media_operations o WHERE o.bucket_id=s.bucket_id AND o.storage_path=s.name)) THEN
  RAISE EXCEPTION 'Untracked media appeared during release; review provenance before restriction';
 END IF;
END;$guard$;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.property_images,public.property_floor_plans,public.property_features,public.property_amenities FROM PUBLIC,anon,authenticated,service_role;
DO $guard$
DECLARE r text;t text;p text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH t IN ARRAY ARRAY['property_images','property_floor_plans','property_features','property_amenities'] LOOP
   FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(r,'public.'||t,p) THEN RAISE EXCEPTION 'Residual media write privilege';END IF;
   END LOOP;
   FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
    IF has_any_column_privilege(r,'public.'||t,p) THEN RAISE EXCEPTION 'Residual media column privilege';END IF;
   END LOOP;
  END LOOP;
 END LOOP;
END;$guard$;
CREATE POLICY bedos_property_storage_backend_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id NOT IN ('property-images','property-floor-plans')) WITH CHECK(bucket_id NOT IN ('property-images','property-floor-plans'));
UPDATE storage.buckets SET file_size_limit=3145728,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'] WHERE id IN ('property-images','property-floor-plans');
NOTIFY pgrst,'reload schema';
COMMIT;
