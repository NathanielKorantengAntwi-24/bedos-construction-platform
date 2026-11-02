-- Read-only property media/schema/storage configuration and aggregate checks only.
-- No filenames, object paths, account identifiers, URLs or record contents returned.
BEGIN TRANSACTION READ ONLY;
SELECT json_build_object(
 'tables',(SELECT json_agg(json_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('property_images','property_floor_plans','property_features','property_amenities')),
 'columns',(SELECT json_agg(json_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) ORDER BY table_name,ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('property_images','property_floor_plans','property_features','property_amenities')),
 'constraints',(SELECT json_agg(json_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE conrelid IN ('public.property_images'::regclass,'public.property_floor_plans'::regclass,'public.property_features'::regclass,'public.property_amenities'::regclass)),
 'indexes',(SELECT json_agg(json_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname) FROM pg_indexes WHERE schemaname='public' AND tablename IN ('property_images','property_floor_plans','property_features','property_amenities')),
 'policies',(SELECT json_agg(json_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) ORDER BY tablename,policyname) FROM pg_policies WHERE schemaname='public' AND tablename IN ('property_images','property_floor_plans','property_features','property_amenities')),
 'grants',(SELECT json_agg(json_build_object('table',table_name,'role',grantee,'privilege',privilege_type) ORDER BY table_name,grantee,privilege_type) FROM information_schema.table_privileges WHERE table_schema='public' AND table_name IN ('property_images','property_floor_plans','property_features','property_amenities') AND grantee IN ('PUBLIC','anon','authenticated','service_role')),
 'column_acl_count',(SELECT count(*) FROM pg_attribute WHERE attrelid IN ('public.property_images'::regclass,'public.property_floor_plans'::regclass,'public.property_features'::regclass,'public.property_amenities'::regclass) AND attacl IS NOT NULL),
 'triggers',(SELECT json_agg(json_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'function',p.proname,'definition_md5',md5(pg_get_triggerdef(t.oid)),'body_md5',md5(p.prosrc)) ORDER BY t.tgrelid::regclass::text,t.tgname) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.property_images'::regclass,'public.property_floor_plans'::regclass,'public.property_features'::regclass,'public.property_amenities'::regclass)),
 'storage_tables',(SELECT json_agg(json_build_object('name',c.relname,'rls',c.relrowsecurity) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname IN ('buckets','objects')),
 'storage_policies',(SELECT json_agg(json_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'permissive',permissive,'using_md5',md5(coalesce(qual,'')),'check_md5',md5(coalesce(with_check,''))) ORDER BY tablename,policyname) FROM pg_policies WHERE schemaname='storage' AND tablename IN ('objects','buckets')),
 'buckets',(SELECT json_agg(json_build_object('id',id,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) ORDER BY id) FROM storage.buckets WHERE id IN ('property-images','property-floor-plans')),
 'aggregates',json_build_object(
   'image_rows',(SELECT count(*) FROM public.property_images),'floor_plan_rows',(SELECT count(*) FROM public.property_floor_plans),'feature_rows',(SELECT count(*) FROM public.property_features),'amenity_rows',(SELECT count(*) FROM public.property_amenities),
   'image_objects',(SELECT count(*) FROM storage.objects WHERE bucket_id='property-images'),'floor_plan_objects',(SELECT count(*) FROM storage.objects WHERE bucket_id='property-floor-plans'),
   'multiple_primary_properties',(SELECT count(*) FROM (SELECT property_id FROM public.property_images WHERE is_primary GROUP BY property_id HAVING count(*)>1) t),
   'duplicate_image_paths',(SELECT count(*) FROM (SELECT storage_path FROM public.property_images GROUP BY storage_path HAVING count(*)>1) t),
   'duplicate_floor_plan_paths',(SELECT count(*) FROM (SELECT storage_path FROM public.property_floor_plans GROUP BY storage_path HAVING count(*)>1) t),
   'negative_orders',(SELECT (SELECT count(*) FROM public.property_images WHERE display_order<0)+(SELECT count(*) FROM public.property_floor_plans WHERE display_order<0)),
   'image_metadata_without_object',(SELECT count(*) FROM public.property_images i WHERE NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='property-images' AND o.name=i.storage_path)),
   'floor_plan_metadata_without_object',(SELECT count(*) FROM public.property_floor_plans f WHERE NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='property-floor-plans' AND o.name=f.storage_path)),
   'image_objects_without_metadata',(SELECT count(*) FROM storage.objects o WHERE o.bucket_id='property-images' AND NOT EXISTS(SELECT 1 FROM public.property_images i WHERE i.storage_path=o.name)),
   'floor_plan_objects_without_metadata',(SELECT count(*) FROM storage.objects o WHERE o.bucket_id='property-floor-plans' AND NOT EXISTS(SELECT 1 FROM public.property_floor_plans f WHERE f.storage_path=o.name))
 ),
 'last_migration',(SELECT max(version) FROM supabase_migrations.schema_migrations)
) evidence;
COMMIT;
