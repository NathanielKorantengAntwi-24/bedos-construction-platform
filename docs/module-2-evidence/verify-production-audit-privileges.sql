-- Metadata and cleanup counts only; no destructive production permission probes.
SELECT
 (SELECT count(*) FROM unnest(ARRAY['anon','authenticated','service_role']) r
 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
 WHERE has_table_privilege(r,'public.audit_logs',p) IS DISTINCT FROM
 (r='service_role' AND p IN ('SELECT','INSERT'))) AS table_privilege_mismatches,
 (SELECT count(*) FROM unnest(ARRAY['anon','authenticated','service_role']) r
 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
 WHERE has_any_column_privilege(r,'public.audit_logs',p) IS DISTINCT FROM
 (r='service_role' AND p IN ('SELECT','INSERT'))) AS column_privilege_mismatches,
 (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101030000'
 AND name='restrict_audit_log_privileges') AS migration_rows,
 (SELECT count(*) FROM auth.users WHERE email LIKE '%@bedos-setup-test.invalid') AS rollback_fixture_users,
 (SELECT count(*) FROM pg_trigger WHERE tgname IN ('bedos_setup_test_audit','bedos_setup_test_profile')) AS rollback_test_triggers,
 (SELECT count(*) FROM public.audit_logs WHERE action='bedos_audit_release_probe') AS rollback_service_audits,
 pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls,
 (SELECT count(*) FROM pg_policy WHERE polrelid=c.oid) AS policy_count
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='audit_logs';
