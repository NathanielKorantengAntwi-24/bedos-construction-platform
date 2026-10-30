BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='20s';
WITH funcs AS (
 SELECT p.oid::regprocedure::text AS signature,p.proname AS name,p.prosecdef AS security_definer,
        p.proconfig AS settings,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
        has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_execute,
        pg_get_functiondef(p.oid) AS definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'bedos_%staff_invitation%'
), permissions AS (
 SELECT r.name AS role,p.name AS permission
 FROM public.roles r LEFT JOIN public.role_permissions rp ON rp.role_id=r.id
 LEFT JOIN public.permissions p ON p.id=rp.permission_id ORDER BY r.name,p.name
), table_grants AS (
 SELECT table_name,grantee,privilege_type FROM information_schema.table_privileges
 WHERE table_schema='public' AND table_name IN ('staff_invitations','profiles','roles','permissions','role_permissions','audit_logs')
 AND grantee IN ('PUBLIC','anon','authenticated','service_role')
), policies AS (
 SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('staff_invitations','audit_logs')
), constraints AS (
 SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
 WHERE conrelid='public.staff_invitations'::regclass
), module_functions AS (
 SELECT p.oid::regprocedure::text AS signature FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND
 (p.proname ILIKE '%user%' OR p.proname ILIKE '%staff%' OR p.proname ILIKE '%role%' OR p.proname ILIKE '%profile%')
)
SELECT 'staff_functions' AS section,coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) AS evidence FROM funcs f
UNION ALL SELECT 'permission_matrix',coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM permissions p
UNION ALL SELECT 'table_grants',coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM table_grants g
UNION ALL SELECT 'policies',coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM policies p
UNION ALL SELECT 'invitation_constraints',coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM constraints c
UNION ALL SELECT 'related_function_inventory',coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) FROM module_functions f;
COMMIT;
