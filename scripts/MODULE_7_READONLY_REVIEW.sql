-- Metadata and aggregate counts only. No application rows or credentials.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT 'columns' section,coalesce(jsonb_agg(to_jsonb(x)),'[]') evidence FROM (
 SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
 WHERE table_schema='public' AND table_name LIKE 'project%' ORDER BY table_name,ordinal_position) x
UNION ALL SELECT 'constraints',coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
 SELECT c.conrelid::regclass::text relation,c.conname,pg_get_constraintdef(c.oid) definition FROM pg_constraint c
 WHERE c.conrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'project%')
 OR c.confrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'project%') ORDER BY 1,2) x
UNION ALL SELECT 'security',coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
 SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('projects','project_stages','project_images') ORDER BY 1) x
UNION ALL SELECT 'policies',coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
 SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'project%' ORDER BY 1,2) x
UNION ALL SELECT 'grants',coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
 SELECT table_name,grantee,string_agg(privilege_type,',' ORDER BY privilege_type) privileges FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name LIKE 'project%' AND grantee IN ('anon','authenticated','service_role') GROUP BY 1,2 ORDER BY 1,2) x
UNION ALL SELECT 'indexes',coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
 SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'project%' ORDER BY 1,2) x
UNION ALL SELECT 'triggers',coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
 SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'project%' AND NOT t.tgisinternal ORDER BY 1,2) x
UNION ALL SELECT 'permissions',coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
 SELECT p.name permission,r.name role FROM public.permissions p LEFT JOIN public.role_permissions rp ON rp.permission_id=p.id LEFT JOIN public.roles r ON r.id=rp.role_id WHERE p.name LIKE 'projects.%' ORDER BY 1,2) x
UNION ALL SELECT 'counts',jsonb_build_object('projects',(SELECT count(*) FROM public.projects),'stages',(SELECT count(*) FROM public.project_stages),'images',(SELECT count(*) FROM public.project_images),'project_storage_objects',(SELECT count(*) FROM storage.objects WHERE bucket_id LIKE '%project%' AND bucket_id NOT LIKE '%interior%'))
UNION ALL SELECT 'buckets',coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
 SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id LIKE '%project%' AND id NOT LIKE '%interior%' ORDER BY id) x
UNION ALL SELECT 'storage_policies',coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
 SELECT policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname) x;
COMMIT;
