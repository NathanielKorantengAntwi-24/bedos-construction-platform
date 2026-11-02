// Local preparation only. Does not connect to production or read any credentials.
import fs from 'node:fs';import crypto from 'node:crypto';
const ref=fs.readFileSync('supabase/.temp/project-ref','utf8').trim();if(ref!=='zjdqomckldeipigqqfqm')throw Error('Linked project guard');
const directory='.next/module6-release';fs.mkdirSync(directory,{recursive:true});
const phases=[{version:'20261102010000',name:'secure_property_viewings',previous:'20261101090000'},{version:'20261102020000',name:'restrict_property_viewing_writes',previous:'20261102010000'}];
const bodies=[];for(const [i,p]of phases.entries()){
 const body=fs.readFileSync(`supabase/migrations/${p.version}_${p.name}.sql`,'utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');bodies.push(body);
 if(body.includes('$bedos_m6_history$'))throw Error('SQL delimiter guard');
 fs.writeFileSync(directory+`/0${i+1}-${p.name}.sql`,`-- Reviewed production project ${ref}. ${i?'ONLY after compatible production deployment is healthy.':'Additive guarded functions; existing writers remain temporarily compatible.'}
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${p.version}') OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'${p.previous}' THEN RAISE EXCEPTION 'Unexpected migration history; do not rerun blindly';END IF;END;$guard$;
${body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${p.version}','${p.name}',ARRAY[$bedos_m6_history$${body}$bedos_m6_history$]);
COMMIT;
SELECT '${p.version}' AS migration_committed;
`);
}
const tests=fs.readFileSync('scripts/sql/Test-Module6Viewings.sql','utf8').replace(/ -- BEGIN LOCAL PERMISSION REVOCATION PROBE[\s\S]*? -- END LOCAL PERMISSION REVOCATION PROBE/,'');
if(/DELETE\s+FROM\s+public\.(audit_logs|role_permissions|permissions)|TRUNCATE\s+public\./i.test(tests))throw Error('Nonfixture rollback mutation guard');
fs.writeFileSync(directory+'/03-rollback-verification.sql',`-- Synthetic SQL fixtures only; no email or external notification delivery. All record writes roll back.
BEGIN;
SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='5s';
${tests}
DO $count$ BEGIN IF (SELECT count(*) FROM viewing_checks)<>139 THEN RAISE EXCEPTION 'Unexpected viewing assertion count';END IF;END;$count$;
ROLLBACK;SELECT 139 AS assertions_verified,'rolled_back' AS fixture_transaction;
`);
const md5=s=>crypto.createHash('md5').update(s).digest('hex');
const functions=[...bodies[0].matchAll(/CREATE FUNCTION public\.(\w+)\([\s\S]*?AS \$function\$\r?\n?([\s\S]*?)\$function\$;/g)].map(m=>({name:m[1],hash:md5(m[2].replace(/\s+/g,'')),definer:!['bedos_viewing_project','bedos_viewing_validate','bedos_viewing_version'].includes(m[1]),execute:['bedos_read_viewings','bedos_mutate_viewing','bedos_viewing_events','bedos_deliver_viewing_event'].includes(m[1])}));if(functions.length!==9)throw Error('Expected nine functions');
const local=JSON.parse(fs.readFileSync('docs/MODULE_6_LOCAL_CATALOG.json','utf8')),verified=JSON.parse(fs.readFileSync('docs/module-6-evidence/local-viewing-sql.json','utf8'));
if(!verified.passed||verified.assertions!==140||!verified.active_read_policy?.hash||!verified.notification_event_index?.hash)throw Error('Expected current local SQL verification');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const jsonLiteral=value=>quote(JSON.stringify(value))+'::jsonb';
const statusHash=md5(local.constraints.find(c=>c.name==='viewing_requests_status_check').definition.replace("'in_progress'::text","'scheduled'::text"));
const oldPolicies=jsonLiteral(local.policies),oldNotificationGrants=jsonLiteral(local.grants.filter(g=>g.table==='notifications')),oldNotificationIndexes=jsonLiteral(local.indexes.filter(x=>x.table==='notifications'));
const propertySource=fs.readFileSync('supabase/migrations/20261101060000_secure_property_management.sql','utf8');const propertyBody=propertySource.match(/CREATE FUNCTION public\.bedos_guard_property_reference\(\)[\s\S]*?AS \$function\$\r?\n?([\s\S]*?)\$function\$;/)[1];
const sql=`WITH expected(name,hash,definer,service_execute) AS (VALUES ${functions.map(f=>`('${f.name}','${f.hash}',${f.definer},${f.execute})`).join(',\n')})
SELECT 'function_count' check_name,count(*)::text value FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN(SELECT name FROM expected)
UNION ALL SELECT 'function_mismatches',count(*)::text FROM expected e LEFT JOIN (pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public') ON p.proname=e.name WHERE p.oid IS NULL OR md5(regexp_replace(p.prosrc,'\\s+','','g'))<>e.hash OR p.prosecdef<>e.definer OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT coalesce(p.proconfig @> ARRAY['search_path=""'],false) OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE')<>e.service_execute
UNION ALL SELECT 'direct_table_writes',count(*)::text FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege WHERE has_table_privilege(r,'public.viewing_requests',privilege)
UNION ALL SELECT 'direct_column_writes',count(*)::text FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['INSERT','UPDATE','REFERENCES']) privilege WHERE has_any_column_privilege(r,'public.viewing_requests',privilege)
UNION ALL SELECT 'queue_privileges',count(*)::text FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege WHERE has_table_privilege(r,'public.viewing_notification_events',privilege)
UNION ALL SELECT 'rls_tables',count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('viewing_requests','viewing_notification_events') AND c.relrowsecurity
UNION ALL SELECT 'version_column',count(*)::text FROM information_schema.columns WHERE table_schema='public' AND table_name='viewing_requests' AND column_name='version' AND data_type='integer' AND is_nullable='NO' AND column_default='1'
UNION ALL SELECT 'version_trigger',count(*)::text FROM pg_trigger WHERE tgrelid='public.viewing_requests'::regclass AND tgname='viewing_requests_version' AND tgenabled='O' AND tgfoid='public.bedos_viewing_version()'::regprocedure
UNION ALL SELECT 'canonical_status_constraint',count(*)::text FROM pg_constraint WHERE conrelid='public.viewing_requests'::regclass AND conname='viewing_requests_status_check' AND md5(pg_get_constraintdef(oid))='${statusHash}'
UNION ALL SELECT 'active_read_guard',count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='viewing_requests' AND policyname='bedos_viewing_active_read' AND permissive='RESTRICTIVE' AND cmd='SELECT' AND roles::text[]=ARRAY['anon','authenticated'] AND md5(qual)='${verified.active_read_policy.hash}'
UNION ALL SELECT 'notification_dedup_index',count(*)::text FROM pg_indexes WHERE schemaname='public' AND indexname='notifications_one_viewing_event_recipient' AND md5(indexdef)='${verified.notification_event_index.hash}'
UNION ALL SELECT 'existing_policies_unchanged',coalesce((SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) ORDER BY tablename,policyname) FROM pg_policies WHERE schemaname='public' AND tablename IN('viewing_requests','notifications') AND policyname<>'bedos_viewing_active_read')=${oldPolicies},false)::text
UNION ALL SELECT 'notification_grants_unchanged',coalesce((SELECT jsonb_agg(jsonb_build_object('table',table_name,'role',grantee,'privilege',privilege_type) ORDER BY table_name,grantee,privilege_type) FROM information_schema.table_privileges WHERE table_schema='public' AND table_name='notifications' AND grantee IN('PUBLIC','anon','authenticated','service_role'))=${oldNotificationGrants},false)::text
UNION ALL SELECT 'original_notification_indexes_unchanged',coalesce((SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='notifications' AND indexname<>'notifications_one_viewing_event_recipient')=${oldNotificationIndexes},false)::text
UNION ALL SELECT 'publication_helper_unchanged',count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bedos_guard_property_reference' AND p.prosecdef AND md5(regexp_replace(p.prosrc,'\\s+','','g'))='${md5(propertyBody.replace(/\s+/g,''))}' AND coalesce(p.proconfig @> ARRAY['search_path=""'],false)
UNION ALL SELECT 'publication_guards',count(*)::text FROM pg_trigger WHERE tgname IN('viewing_property_publication_guard','enquiry_property_publication_guard') AND tgenabled='O' AND tgfoid='public.bedos_guard_property_reference()'::regprocedure
UNION ALL SELECT 'migration_rows',count(*)::text FROM supabase_migrations.schema_migrations WHERE version IN('20261102010000','20261102020000')
UNION ALL SELECT 'rollback_auth_fixtures',count(*)::text FROM auth.users WHERE email LIKE '%@bedos-viewing-test.invalid'
UNION ALL SELECT 'rollback_failure_triggers',count(*)::text FROM pg_trigger WHERE tgname IN('bedos_viewing_test_audit','bedos_viewing_test_notification')
ORDER BY check_name;`;
fs.writeFileSync(directory+'/04-metadata-verification.sql',sql+'\n');fs.copyFileSync('docs/MODULE_6_PRODUCTION_COMPARISON.sql',directory+'/00-read-only-preflight.sql');
console.log(JSON.stringify({prepared_directory:directory,phase_one:phases[0].version,phase_two:phases[1].version,function_count:9,production_rollback_assertions:139,production_changes:false}));
