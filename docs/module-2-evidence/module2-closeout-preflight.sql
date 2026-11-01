BEGIN TRANSACTION READ ONLY;
SELECT 'grants' AS section,coalesce(jsonb_agg(jsonb_build_object('role',grantee,'privilege',privilege_type) ORDER BY grantee,privilege_type),'[]'::jsonb) AS evidence FROM information_schema.table_privileges WHERE table_schema='public' AND table_name='audit_logs' AND grantee IN ('PUBLIC','anon','authenticated','service_role')
UNION ALL SELECT 'policies',coalesce(jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,'command',cmd)),'[]'::jsonb) FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs'
UNION ALL SELECT 'audit_security',jsonb_build_object('rls',relrowsecurity,'owner',pg_get_userbyid(relowner)) FROM pg_class WHERE oid='public.audit_logs'::regclass
UNION ALL SELECT 'server_owned_auth_metadata',to_jsonb(count(*)) FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='raw_app_meta_data';
COMMIT;
