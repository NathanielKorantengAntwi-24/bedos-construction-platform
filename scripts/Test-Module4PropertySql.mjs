// All migrations, fixtures, role seeds and failure triggers are rolled back in an isolated lab.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!==`/${container}`||!info.Config.Image.includes('supabase/postgres')||!info.State.Running)throw Error('Local database guard failed');
const migration=name=>fs.readFileSync(`supabase/migrations/${name}`,'utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
const sql=`BEGIN; SET LOCAL statement_timeout='45s'; SET LOCAL lock_timeout='5s';
${migration('20261101040000_secure_service_catalog.sql')}
CREATE TEMP TABLE property_original_grants AS SELECT r,p,has_table_privilege(r,'public.properties',p) allowed
FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
${migration('20261101060000_secure_property_management.sql')}
DO $phase$ BEGIN IF EXISTS(SELECT 1 FROM property_original_grants WHERE has_table_privilege(r,'public.properties',p) IS DISTINCT FROM allowed) THEN RAISE EXCEPTION 'Phase one changed grants';END IF;END;$phase$;
${migration('20261101070000_restrict_property_writes.sql')}
${fs.readFileSync('scripts/sql/Test-Module4Property.sql','utf8')}
SELECT json_build_object('assertions',count(*)) FROM property_checks;
ROLLBACK;`;
try {
  const output=execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
  const summary=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{"assertions"'))||'null');
  if(!summary||summary.assertions<90||!output.includes('ROLLBACK'))throw Error('Missing assertion or rollback evidence');
  const report={date:new Date().toISOString(),scope:'Guarded local database; migration, fixtures and permissions rolled back',...summary,phase_one_preserves_grants:true,status:'passed'};
  fs.mkdirSync('docs/module-4-evidence',{recursive:true});fs.writeFileSync('docs/module-4-evidence/local-property-sql.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} catch(error) { console.error(error.stderr?.toString()||error.message);process.exitCode=1; }
