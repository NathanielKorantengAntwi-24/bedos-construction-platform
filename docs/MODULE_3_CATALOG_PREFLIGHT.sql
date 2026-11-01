-- Read-only catalog and aggregate-length inspection. No row contents or credentials returned.
BEGIN TRANSACTION READ ONLY;
SELECT json_build_object(
 'tables',(SELECT json_agg(json_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('services','service_categories')),
 'columns',(SELECT json_agg(json_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) ORDER BY table_name,ordinal_position)
 FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('services','service_categories')),
 'constraints',(SELECT json_agg(json_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)))
 FROM pg_constraint WHERE conrelid IN ('public.services'::regclass,'public.service_categories'::regclass) OR confrelid IN ('public.services'::regclass,'public.service_categories'::regclass)),
 'policies',(SELECT json_agg(json_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check))
 FROM pg_policies WHERE schemaname='public' AND tablename IN ('services','service_categories')),
 'triggers',(SELECT json_agg(json_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'function',p.proname,'definition_md5',md5(pg_get_triggerdef(t.oid)),'body_md5',md5(p.prosrc)))
 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.services'::regclass,'public.service_categories'::regclass)),
 'related_triggers',(SELECT json_agg(json_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'function',p.proname,'definition_md5',md5(pg_get_triggerdef(t.oid)),'body_md5',md5(p.prosrc)))
 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.enquiries'::regclass,'public.audit_logs'::regclass)),
 'grants',(SELECT json_agg(json_build_object('table',table_name,'role',grantee,'privilege',privilege_type)) FROM information_schema.table_privileges
 WHERE table_schema='public' AND table_name IN ('services','service_categories') AND grantee IN ('PUBLIC','anon','authenticated','service_role')),
 'role_permissions',(SELECT json_agg(json_build_object('role',r.name,'permission',p.name) ORDER BY r.name,p.name)
 FROM public.role_permissions rp JOIN public.roles r ON r.id=rp.role_id JOIN public.permissions p ON p.id=rp.permission_id WHERE p.name IN ('services.view','services.manage')),
 'legacy_field_lengths',json_build_object(
   'services',(SELECT json_build_object('name_max',coalesce(max(char_length(name)),0),'slug_max',coalesce(max(char_length(slug)),0),'description_max',coalesce(max(char_length(description)),0)) FROM public.services),
   'categories',(SELECT json_build_object('name_max',coalesce(max(char_length(name)),0),'slug_max',coalesce(max(char_length(slug)),0),'description_max',coalesce(max(char_length(description)),0)) FROM public.service_categories)),
 'pending_function_collisions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('bedos_require_catalog_permission','bedos_validate_catalog_input','bedos_catalog_audit','bedos_mutate_service','bedos_mutate_service_category','bedos_read_service_catalog')),
 'last_migration',(SELECT max(version) FROM supabase_migrations.schema_migrations)
) AS evidence;
COMMIT;
