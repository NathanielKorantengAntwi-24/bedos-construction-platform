// Validate the exact prepared release SQL/history wrappers in one LOCAL rollback.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!==`/${container}`||!info.Config.Image.includes('supabase/postgres'))throw Error('Local DB guard failed');
const sql=query=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
const stateQuery=`SELECT json_build_object(
 'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('bedos_require_catalog_permission','bedos_validate_catalog_input','bedos_catalog_audit','bedos_mutate_service','bedos_mutate_service_category','bedos_read_service_catalog','bedos_validate_property_input','bedos_validate_property_filters','bedos_read_properties','bedos_mutate_property','bedos_guard_property_reference')),
 'history',(SELECT coalesce(json_agg(version ORDER BY version),'[]') FROM supabase_migrations.schema_migrations WHERE version IN('20261101050000','20261101060000','20261101070000')),
 'auth_fixtures',(SELECT count(*) FROM auth.users WHERE email LIKE '%@property-test.invalid'));`;
const before=JSON.parse(sql(stateQuery));
if(before.functions!==0)throw Error('Existing catalog functions require review before local wrapper test');
execFileSync(process.execPath,['scripts/Prepare-Module4Release.mjs'],{encoding:'utf8',windowsHide:true});
const read=file=>fs.readFileSync('.next/module4-release/'+file,'utf8');
const strip=source=>source.replace(/^BEGIN;\r?$/gm,'').replace(/^COMMIT;\r?$/gm,'');
try{
 const input=`BEGIN;
${strip(fs.readFileSync('supabase/migrations/20261101040000_secure_service_catalog.sql','utf8'))}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261101050000','local_release_wrapper_baseline',ARRAY[]::text[]) ON CONFLICT(version) DO NOTHING;
${strip(read('01-secure_property_management.sql'))}
${strip(read('02-restrict_property_writes.sql'))}
${read('04-metadata-verification.sql')}
${read('03-rollback-verification.sql')}`;
 const out=sql(input);
 for(const expected of ['function_count|5','function_mismatches|0','table_write_privileges|0','column_write_privileges|0','migration_rows|2','rls_enabled_tables|1','114|rolled_back'])if(!out.includes(expected))throw Error('Prepared release assertion failed: '+expected);
 const after=JSON.parse(sql(stateQuery));if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Local wrapper state not restored');
 const report={date:new Date().toISOString(),scope:'Generated release wrappers and migration history tracking validated inside one local rollback transaction; no production calls',function_source_acl_owner_path_mismatches:0,guarded_functions:5,temporary_migration_rows:2,production_safe_rollback_assertions:114,original_state_restored:true,status:'passed'};
 fs.writeFileSync('docs/module-4-evidence/local-release-wrapper-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(e){console.error(e.stderr?.toString()||e.message);process.exitCode=1;}
