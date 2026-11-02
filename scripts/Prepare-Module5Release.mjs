// Prepares reviewable SQL only. Does not connect to any database or read credentials.
import fs from 'node:fs';
import crypto from 'node:crypto';
const target=fs.readFileSync('supabase/.temp/project-ref','utf8').trim();
if(target!=='zjdqomckldeipigqqfqm')throw Error('Expected linked project guard failed');
const directory='.next/module5-release';fs.mkdirSync(directory,{recursive:true});
const phases=[
 {version:'20261101080000',name:'secure_property_media',previous:'20261101070000'},
 {version:'20261101090000',name:'restrict_property_media_access',previous:'20261101080000'},
];
const bodies=[];
for(const [index,phase] of phases.entries()){
 const body=fs.readFileSync(`supabase/migrations/${phase.version}_${phase.name}.sql`,'utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');bodies.push(body);
 const delimiter='$bedos_migration_history$';if(body.includes(delimiter))throw Error('Migration quote guard failed');
 const sql=`-- Approved linked project: ${target}. ${index===1?'Run ONLY after new application deployment is healthy.':'Install guarded RPCs before deploying the application.'}
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $history_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${phase.version}') OR
 (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'${phase.previous}' THEN
 RAISE EXCEPTION 'Unexpected migration history; do not rerun blindly';END IF;
END;$history_guard$;
${body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES('${phase.version}','${phase.name}',ARRAY[${delimiter}${body}${delimiter}]);
COMMIT;
SELECT '${phase.version}' AS migration_committed;
`;
 fs.writeFileSync(`${directory}/0${index+1}-${phase.name}.sql`,sql);
}
const core=fs.readFileSync('scripts/sql/Test-Module5Media.sql','utf8').replace(/ -- BEGIN LOCAL STORAGE CATALOG PROBES[\s\S]*? -- END LOCAL STORAGE CATALOG PROBES/, '');
if(/TRUNCATE\s+public\.|TRUNCATE\s+TABLE|DELETE\s+FROM\s+public\.audit_logs/i.test(core))throw Error('Production rollback probe contains a forbidden audit/destructive permission statement');
fs.writeFileSync(`${directory}/03-rollback-verification.sql`,`-- Synthetic test fixtures only; no email delivery or existing business-record writes.
BEGIN;SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='5s';
${core}
DO $acceptance$ BEGIN IF (SELECT count(*) FROM media_checks)<>123 THEN RAISE EXCEPTION 'Unexpected catalog assertion count';END IF;END;$acceptance$;
ROLLBACK;
SELECT 123 AS assertions_verified,'rolled_back' AS fixture_transaction;
`);
const functions=[...bodies[0].matchAll(/CREATE FUNCTION public\.(\w+)\([\s\S]*?AS \$function\$\n?([\s\S]*?)\$function\$;/g)].map(m=>({name:m[1],hash:crypto.createHash('md5').update(m[2].replace(/\s+/g,'')).digest('hex'),definer:!['bedos_media_validate','bedos_media_parent_removed'].includes(m[1]),execute:['bedos_media_read','bedos_media_metadata','bedos_media_upload','bedos_media_finalize','bedos_media_operation'].includes(m[1])}));
if(functions.length!==9)throw Error('Expected nine reviewed property-media functions');
const values=functions.map(f=>`('${f.name}','${f.hash}',${f.definer},${f.execute})`).join(',\n');
fs.writeFileSync(`${directory}/04-metadata-verification.sql`,`WITH expected(name,hash,definer,service_execute) AS (VALUES ${values})
SELECT 'function_count' AS check_name,(SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN(SELECT name FROM expected)) AS value
UNION ALL SELECT 'function_mismatches',count(*)::text FROM expected e LEFT JOIN (pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public') ON p.proname=e.name
WHERE p.oid IS NULL OR md5(regexp_replace(p.prosrc,'\\s+','','g'))<>e.hash OR p.prosecdef<>e.definer OR pg_get_userbyid(p.proowner)<>'postgres'
 OR NOT coalesce(p.proconfig @> ARRAY['search_path=""'],false) OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE')<>e.service_execute
UNION ALL SELECT 'table_write_privileges',count(*)::text FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['public.property_images','public.property_floor_plans','public.property_features','public.property_amenities']) t CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege WHERE has_table_privilege(r,t,privilege)
UNION ALL SELECT 'column_write_privileges',count(*)::text FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['public.property_images','public.property_floor_plans','public.property_features','public.property_amenities']) t CROSS JOIN unnest(ARRAY['INSERT','UPDATE','REFERENCES']) privilege WHERE has_any_column_privilege(r,t,privilege)
UNION ALL SELECT 'migration_rows',count(*)::text FROM supabase_migrations.schema_migrations WHERE version IN('20261101080000','20261101090000')
UNION ALL SELECT 'rls_enabled_tables',count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('property_images','property_floor_plans','property_features','property_amenities','property_media_operations') AND c.relrowsecurity
UNION ALL SELECT 'rollback_auth_fixtures',count(*)::text FROM auth.users WHERE email LIKE '%@bedos-media-test.invalid'
UNION ALL SELECT 'rollback_failure_triggers',count(*)::text FROM pg_trigger WHERE tgname='bedos_media_test_audit'
ORDER BY check_name;
`);
const metadataPath=directory+'/04-metadata-verification.sql';
const baseline=JSON.stringify(JSON.parse(fs.readFileSync('docs/module-5-evidence/production-preflight.json','utf8')).storage_policies);
if(baseline.includes('$bedos_storage_policies$'))throw Error('Policy quote guard failed');
const predicate="(bucket_id <> ALL (ARRAY['property-images'::text, 'property-floor-plans'::text]))";
const predicateHash=crypto.createHash('md5').update(predicate).digest('hex');
const extra=`UNION ALL SELECT 'private_ledger_privileges',count(*)::text FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege WHERE has_table_privilege(r,'public.property_media_operations',privilege)
UNION ALL SELECT 'configured_private_buckets',count(*)::text FROM storage.buckets WHERE id IN('property-images','property-floor-plans') AND NOT public AND file_size_limit=3145728 AND allowed_mime_types @> ARRAY['image/jpeg','image/png','image/webp'] AND cardinality(allowed_mime_types)=3
UNION ALL SELECT 'restrictive_storage_guard',count(*)::text FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='bedos_property_storage_backend_only' AND permissive='RESTRICTIVE' AND cmd='ALL' AND roles::text[]=ARRAY['anon','authenticated'] AND md5(qual)='${predicateHash}' AND md5(with_check)='${predicateHash}'
UNION ALL SELECT 'existing_storage_policies_unchanged',(coalesce((SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'permissive',permissive,'using_md5',md5(coalesce(qual,'')),'check_md5',md5(coalesce(with_check,''))) ORDER BY tablename,policyname) FROM pg_policies WHERE schemaname='storage' AND tablename IN('objects','buckets') AND policyname<>'bedos_property_storage_backend_only'),'[]'::jsonb)=$bedos_storage_policies$${baseline}$bedos_storage_policies$::jsonb)::text
ORDER BY check_name;`;
fs.writeFileSync(metadataPath,fs.readFileSync(metadataPath,'utf8').replace('ORDER BY check_name;',()=>extra));
fs.copyFileSync('docs/MODULE_5_CATALOG_PREFLIGHT.sql',directory+'/00-read-only-preflight.sql');
console.log(JSON.stringify({prepared_directory:directory,phase_one:phases[0].version,phase_two:phases[1].version,production_rollback_assertions:123,expected_function_count:9,production_changes:false}));
