BEGIN TRANSACTION READ ONLY;
SELECT 'columns' AS section,jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable) ORDER BY table_name,ordinal_position) AS evidence FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('profiles','roles','staff_invitations','audit_logs')
UNION ALL SELECT 'dependencies',jsonb_agg(jsonb_build_object('name',p.proname,'security_definer',p.prosecdef,'settings',p.proconfig,'normalized_body_md5',md5(regexp_replace(p.prosrc,'\s+','','g')))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_user_role','update_own_profile','bedos_update_user_status')
UNION ALL SELECT 'role_permission_matrix',jsonb_agg(jsonb_build_object('role',r.name,'permission',p.name) ORDER BY r.name,p.name) FROM public.roles r JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id
UNION ALL SELECT 'new_role_function_count',to_jsonb(count(*)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bedos_update_user_role';
COMMIT;
