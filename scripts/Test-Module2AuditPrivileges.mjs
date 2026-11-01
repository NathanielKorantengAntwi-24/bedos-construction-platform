import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!==`/${container}`||!info.Config.Image.includes('supabase/postgres')||!info.State.Running)throw Error('Running local DB guard failed');
const migration=name=>fs.readFileSync(`supabase/migrations/${name}`,'utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
const sql=`BEGIN;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';
${migration('20261101030000_restrict_audit_log_privileges.sql')}
${fs.readFileSync('scripts/sql/Test-Module2AuditPrivileges.sql','utf8')}
${migration('20261101020000_add_trusted_staff_setup_resume.sql')}
${fs.readFileSync('scripts/sql/Test-Module2StaffResume.sql','utf8')}
ROLLBACK;`;
try{
 const output=execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 const reports=output.split(/\r?\n/).filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
 const privileges=reports.find(x=>x.audit_privilege_assertions);
 const rpc=reports.find(x=>x.assertions);
 if(!output.includes('ROLLBACK')||privileges?.audit_privilege_assertions!==35||rpc?.assertions<60)throw Error('Expected rollback/assertions missing');
 const report={date:new Date().toISOString(),scope:'Isolated local lab; grants, fixtures, triggers and setup function rolled back',...privileges,rpc_regression_assertions:rpc.assertions,status:'passed'};
 fs.writeFileSync('docs/module-2-evidence/local-audit-privileges.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}catch(e){console.error(e.stderr?.toString()||e.message);process.exitCode=1;}
