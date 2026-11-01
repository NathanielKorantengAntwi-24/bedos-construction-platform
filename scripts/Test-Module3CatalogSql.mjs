// Local lab only. Migration, permission seeds, fixtures and triggers roll back together.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!==`/${container}`||!info.Config.Image.includes('supabase/postgres')||!info.State.Running)throw Error('Local DB guard failed');
const migration=file=>fs.readFileSync(`supabase/migrations/${file}`,'utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
const input=`BEGIN;SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='5s';
${migration('20261101030000_restrict_audit_log_privileges.sql')}
CREATE TEMP TABLE catalog_original_grants AS
SELECT r,t,p,has_table_privilege(r,t,p) AS allowed FROM unnest(ARRAY['anon','authenticated','service_role']) r
CROSS JOIN unnest(ARRAY['public.services','public.service_categories']) t
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
${migration('20261101040000_secure_service_catalog.sql')}
DO $phase$ BEGIN IF EXISTS(SELECT 1 FROM catalog_original_grants WHERE has_table_privilege(r,t,p) IS DISTINCT FROM allowed) THEN RAISE EXCEPTION 'Phase one changed existing grants';END IF;END;$phase$;
${migration('20261101050000_restrict_service_catalog_writes.sql')}
${fs.readFileSync('scripts/sql/Test-Module3Catalog.sql','utf8')}
${fs.readFileSync('scripts/sql/Test-Module3CatalogDirectWriteDenials.sql','utf8')}
SELECT json_build_object('assertions',count(*)) FROM catalog_checks;
ROLLBACK;`;
try{
 const out=execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const summary=JSON.parse(out.split(/\r?\n/).find(x=>x.startsWith('{"assertions"'))||'null');
 if(!summary||summary.assertions<100||!out.includes('ROLLBACK'))throw Error('Missing assertion/rollback evidence');
 fs.mkdirSync('docs/module-3-evidence',{recursive:true});
 const report={date:new Date().toISOString(),scope:'Actual SQL in guarded local lab; audit/catalog grants, all functions, permission seeds, fixtures and failure trigger rolled back',...summary,phase_one_preserves_existing_table_grants:true,status:'passed'};
 fs.writeFileSync('docs/module-3-evidence/local-catalog-sql.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(e){console.error(e.stderr?.toString()||e.message);process.exitCode=1;}
