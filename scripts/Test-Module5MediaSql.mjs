import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!==`/${container}`||!info.Config.Image.includes('supabase/postgres')||!info.State.Running)throw Error('Local database guard failed');
const migration=name=>fs.readFileSync(`supabase/migrations/${name}`,'utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
const input=`BEGIN; SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='5s';
${migration('20261101040000_secure_service_catalog.sql')}
${migration('20261101060000_secure_property_management.sql')}
INSERT INTO storage.buckets(id,name,public) VALUES('property-images','property-images',false),('property-floor-plans','property-floor-plans',false),('bedos-unrelated-sql-test','bedos-unrelated-sql-test',false);
${migration('20261101080000_secure_property_media.sql')}
CREATE POLICY bedos_local_test_storage_allow ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
${migration('20261101090000_restrict_property_media_access.sql')}
${fs.readFileSync('scripts/sql/Test-Module5Media.sql','utf8')}
SELECT json_build_object('assertions',count(*)) FROM media_checks;
ROLLBACK;`;
try {
 const output=execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const result=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{"assertions"'))||'null');
 if(!result||result.assertions<80||!output.includes('ROLLBACK'))throw Error('Missing check or rollback evidence');
 const report={date:new Date().toISOString(),scope:'Actual isolated local SQL; all migrations, metadata/Storage catalog fixtures, grants and policies rolled back',...result,status:'passed'};
 fs.mkdirSync('docs/module-5-evidence',{recursive:true});fs.writeFileSync('docs/module-5-evidence/local-media-sql.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} catch(error){console.error(error.stderr?.toString()||error.message);process.exitCode=1;}
