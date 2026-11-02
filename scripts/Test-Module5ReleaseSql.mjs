// Exact release scripts run inside one guarded LOCAL rollback transaction.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!==`/${container}`||!info.Config.Image.includes('supabase/postgres')||!info.State.Running)throw Error('Local database guard failed');
const sql=input=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
const stateQuery="SELECT json_build_object('functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'bedos_media_%'),'ledger',to_regclass('public.property_media_operations') IS NOT NULL,'history',(SELECT coalesce(json_agg(version ORDER BY version),'[]') FROM supabase_migrations.schema_migrations WHERE version IN('20261101070000','20261101080000','20261101090000')),'auth_fixtures',(SELECT count(*) FROM auth.users WHERE email LIKE '%@bedos-media-test.invalid'));";
const before=JSON.parse(sql(stateQuery));if(before.functions!==0||before.ledger)throw Error('Existing media lab state needs review');
execFileSync(process.execPath,['scripts/Prepare-Module5Release.mjs'],{encoding:'utf8',windowsHide:true});
const read=name=>fs.readFileSync('.next/module5-release/'+name,'utf8');
const strip=source=>source.replace(/^BEGIN;\r?$/gm,'').replace(/^COMMIT;\r?$/gm,'');
const migration=name=>strip(fs.readFileSync('supabase/migrations/'+name,'utf8'));
// The local lab has no existing Storage policies. Only this expected baseline differs.
const localMetadata=read('04-metadata-verification.sql').replace(/\$bedos_storage_policies\$[\s\S]*?\$bedos_storage_policies\$/,()=>'$bedos_storage_policies$[]$bedos_storage_policies$');
try {
 const output=sql(`BEGIN;
${migration('20261101040000_secure_service_catalog.sql')}
${migration('20261101060000_secure_property_management.sql')}
${migration('20261101070000_restrict_property_writes.sql')}
INSERT INTO storage.buckets(id,name,public) VALUES('property-images','property-images',false),('property-floor-plans','property-floor-plans',false);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261101070000','local_release_baseline',ARRAY[]::text[]) ON CONFLICT(version) DO NOTHING;
${strip(read('01-secure_property_media.sql'))}
${strip(read('02-restrict_property_media_access.sql'))}
${localMetadata}
${read('03-rollback-verification.sql')}`);
 for(const expected of ['function_count|9','function_mismatches|0','table_write_privileges|0','column_write_privileges|0','migration_rows|2','rls_enabled_tables|5','123|rolled_back','private_ledger_privileges|0','configured_private_buckets|2','restrictive_storage_guard|1','existing_storage_policies_unchanged|true'])if(!output.includes(expected))throw Error('Prepared release assertion failed: '+expected);
 if(JSON.stringify(before)!==JSON.stringify(JSON.parse(sql(stateQuery))))throw Error('Original lab state not restored');
 const report={date:new Date().toISOString(),scope:'Generated release/history SQL and production-safe rollback tests validated locally; policy baseline adapted to empty lab only; no production calls',guarded_functions:9,function_source_acl_owner_path_mismatches:0,production_safe_rollback_assertions:123,private_ledger_privileges:0,configured_private_buckets:2,restrictive_storage_guard_verified:true,original_state_restored:true,status:'passed'};
 fs.writeFileSync('docs/module-5-evidence/local-release-wrapper-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error(error.stderr?.toString()||error.message);process.exitCode=1;}
