// All writes run inside one guarded isolated local rollback transaction.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!==`/${container}`||!info.Config.Image.includes('supabase/postgres')||!info.State.Running)throw Error('Local database guard failed');
const files=['20261101040000_secure_service_catalog.sql','20261101060000_secure_property_management.sql','20261102010000_secure_property_viewings.sql','20261102020000_restrict_property_viewing_writes.sql'];
const input='BEGIN;SET LOCAL statement_timeout=\'45s\';SET LOCAL lock_timeout=\'5s\';\n'+files.map(n=>fs.readFileSync('supabase/migrations/'+n,'utf8').replace(/^BEGIN;\r?$/gm,'').replace(/^COMMIT;\r?$/gm,'')).join('\n')+'\n'+fs.readFileSync('scripts/sql/Test-Module6Viewings.sql','utf8')+"\nSELECT jsonb_build_object('active_read_policy',jsonb_build_object('hash',md5(qual),'definition',qual,'roles',roles,'command',cmd,'permissive',permissive)) FROM pg_policies WHERE schemaname='public' AND tablename='viewing_requests' AND policyname='bedos_viewing_active_read';SELECT jsonb_build_object('notification_event_index',jsonb_build_object('hash',md5(indexdef),'definition',indexdef)) FROM pg_indexes WHERE schemaname='public' AND indexname='notifications_one_viewing_event_recipient';\nROLLBACK;";
try {
 const output=execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const report=Object.assign({},...output.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)));
 fs.mkdirSync('docs/module-6-evidence',{recursive:true});fs.writeFileSync('docs/module-6-evidence/local-viewing-sql.json',JSON.stringify({date:new Date().toISOString(),scope:'Isolated local SQL assertions; all synthetic fixtures rolled back',...report},null,2)+'\n');console.log(JSON.stringify(report));
} catch(error){console.error(error.stderr?.toString().slice(-1600)||'Local viewing SQL verification failed');process.exitCode=1;}
