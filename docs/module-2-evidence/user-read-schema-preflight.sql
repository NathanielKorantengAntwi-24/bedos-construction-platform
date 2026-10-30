BEGIN TRANSACTION READ ONLY;
SELECT 'columns' AS section,jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable) ORDER BY table_schema,table_name,ordinal_position) AS evidence FROM information_schema.columns WHERE (table_schema='auth' AND table_name='users' AND column_name IN ('id','email')) OR (table_schema='public' AND table_name IN ('profiles','roles','permissions','role_permissions','staff_invitations'))
UNION ALL SELECT 'indexes',jsonb_agg(jsonb_build_object('table',tablename,'definition',indexdef) ORDER BY tablename,indexname) FROM pg_indexes WHERE schemaname IN ('public','auth') AND tablename IN ('profiles','users','roles','permissions','role_permissions','staff_invitations');
COMMIT;
