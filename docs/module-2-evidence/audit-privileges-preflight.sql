BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
 'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
 'policy_count',(SELECT count(*) FROM pg_policy WHERE polrelid=c.oid),
 'effective_privileges',(SELECT jsonb_agg(jsonb_build_object('role',r,'privilege',p,'allowed',has_table_privilege(r,c.oid,p)) ORDER BY r,p)
   FROM unnest(ARRAY['anon','authenticated','service_role']) r
   CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p),
 'column_grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',grantee,'column',column_name,'privilege',privilege_type)),'[]'::jsonb)
   FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='audit_logs'
   AND grantee IN ('PUBLIC','anon','authenticated','service_role')),
 'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('member',member_role.rolname,'parent',parent_role.rolname)),'[]'::jsonb)
   FROM pg_auth_members m JOIN pg_roles member_role ON member_role.oid=m.member JOIN pg_roles parent_role ON parent_role.oid=m.roleid
   WHERE member_role.rolname IN ('anon','authenticated','service_role'))
) AS evidence FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='audit_logs';
COMMIT;
