// Prepares reviewable SQL only. Does not connect to any database or read credentials.
import fs from 'node:fs';
import crypto from 'node:crypto';
const target=fs.readFileSync('supabase/.temp/project-ref','utf8').trim();
if(target!=='zjdqomckldeipigqqfqm')throw Error('Expected linked project guard failed');
const directory='.next/module4-release';fs.mkdirSync(directory,{recursive:true});
const phases=[
 {version:'20261101060000',name:'secure_property_management',previous:'20261101050000'},
 {version:'20261101070000',name:'restrict_property_writes',previous:'20261101060000'},
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
const core=fs.readFileSync('scripts/sql/Test-Module4Property.sql','utf8');
if(/TRUNCATE\s+public\.|TRUNCATE\s+TABLE|DELETE\s+FROM\s+public\.audit_logs/i.test(core))throw Error('Production rollback probe contains a forbidden audit/destructive permission statement');
fs.writeFileSync(`${directory}/03-rollback-verification.sql`,`-- Synthetic test fixtures only; no email delivery or existing business-record writes.
BEGIN;SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='5s';
${core}
DO $acceptance$ BEGIN IF (SELECT count(*) FROM property_checks)<>114 THEN RAISE EXCEPTION 'Unexpected catalog assertion count';END IF;END;$acceptance$;
ROLLBACK;
SELECT 114 AS assertions_verified,'rolled_back' AS fixture_transaction;
`);
const functions=[...bodies[0].matchAll(/CREATE FUNCTION public\.(\w+)\([\s\S]*?AS \$function\$\n?([\s\S]*?)\$function\$;/g)].map(m=>({name:m[1],hash:crypto.createHash('md5').update(m[2].replace(/\s+/g,'')).digest('hex'),definer:!['bedos_validate_property_input','bedos_validate_property_filters'].includes(m[1]),execute:['bedos_mutate_property','bedos_read_properties'].includes(m[1])}));
if(functions.length!==5)throw Error('Expected five reviewed property functions');
const values=functions.map(f=>`('${f.name}','${f.hash}',${f.definer},${f.execute})`).join(',\n');
fs.writeFileSync(`${directory}/04-metadata-verification.sql`,`WITH expected(name,hash,definer,service_execute) AS (VALUES ${values})
SELECT 'function_count' AS check_name,(SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN(SELECT name FROM expected)) AS value
UNION ALL SELECT 'function_mismatches',count(*)::text FROM expected e LEFT JOIN (pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public') ON p.proname=e.name
WHERE p.oid IS NULL OR md5(regexp_replace(p.prosrc,'\\s+','','g'))<>e.hash OR p.prosecdef<>e.definer OR pg_get_userbyid(p.proowner)<>'postgres'
 OR NOT coalesce(p.proconfig @> ARRAY['search_path=""'],false) OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE')<>e.service_execute
UNION ALL SELECT 'table_write_privileges',count(*)::text FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['public.properties']) t CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege WHERE has_table_privilege(r,t,privilege)
UNION ALL SELECT 'column_write_privileges',count(*)::text FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['public.properties']) t CROSS JOIN unnest(ARRAY['INSERT','UPDATE','REFERENCES']) privilege WHERE has_any_column_privilege(r,t,privilege)
UNION ALL SELECT 'migration_rows',count(*)::text FROM supabase_migrations.schema_migrations WHERE version IN('20261101060000','20261101070000')
UNION ALL SELECT 'rls_enabled_tables',count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('properties') AND c.relrowsecurity
UNION ALL SELECT 'rollback_auth_fixtures',count(*)::text FROM auth.users WHERE email LIKE '%@property-test.invalid'
UNION ALL SELECT 'rollback_failure_triggers',count(*)::text FROM pg_trigger WHERE tgname='bedos_property_test_audit'
ORDER BY check_name;
`);
fs.copyFileSync('docs/MODULE_4_CATALOG_PREFLIGHT.sql',`${directory}/00-read-only-preflight.sql`);
console.log(JSON.stringify({prepared_directory:directory,phase_one:phases[0].version,phase_two:phases[1].version,production_rollback_assertions:114,expected_function_count:5,production_changes:false}));
