// Isolated local rollback verification. Never loads hosted credentials.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!==`/${container}`||!info.Config.Image.includes('supabase/postgres')||!info.State.Running)throw Error('Local database guard failed');
const migrations=['20261101040000_secure_service_catalog.sql','20261102030000_secure_construction_projects.sql','20261102040000_restrict_construction_project_access.sql'];
const source=migrations.map(n=>fs.readFileSync('supabase/migrations/'+n,'utf8').replace(/^BEGIN;\r?$/gm,'').replace(/^COMMIT;\r?$/gm,'')).join('\n');
const input="BEGIN;SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='5s';INSERT INTO storage.buckets(id,name,public) VALUES('project-images','project-images',false) ON CONFLICT DO NOTHING;\n"+source+'\n'+fs.readFileSync('scripts/sql/Test-Module7Projects.sql','utf8')+'\nROLLBACK;';
try {
 const out=execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const report=Object.assign({},...out.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)));
 fs.mkdirSync('docs/module-7-evidence',{recursive:true});fs.writeFileSync('docs/module-7-evidence/local-project-sql.json',JSON.stringify({date:new Date().toISOString(),scope:'Guarded local PostgreSQL rollback assertions; no persistent schema/data changes',...report},null,2)+'\n');console.log(JSON.stringify({assertions:report.assertions,rollback:true}));
}catch(e){console.error(e.stderr?.toString().slice(-2400)||e.message);process.exitCode=1;}
