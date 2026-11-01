// Guarded local rollback-only setup/resume database regression.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!==`/${container}`||!info.Config.Image.includes('supabase/postgres'))throw Error('Local DB guard failed');
const source=fs.readFileSync('supabase/migrations/20261101020000_add_trusted_staff_setup_resume.sql','utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
const test=fs.readFileSync('scripts/sql/Test-Module2StaffResume.sql','utf8');
try{
 const output=execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input:`BEGIN;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';\n${source}\n${test}\nROLLBACK;`,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
 if(!output.includes('ROLLBACK'))throw Error('Rollback missing');
 const summary=JSON.parse(output.split(/\r?\n/).find(x=>x.startsWith('{"assertions"'))||'null');if(!summary||summary.assertions<60)throw Error('Assertions missing');
 const report={date:new Date().toISOString(),scope:'Local lab only; function, audit/profile failure triggers and fixtures rolled back',...summary,status:'passed'};fs.writeFileSync('docs/module-2-evidence/local-staff-resume-sql.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(e){console.error(e.stderr?.toString()||e.message);process.exitCode=1;}
