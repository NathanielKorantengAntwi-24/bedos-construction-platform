// Independent read-only comparison with the pre-test local schema snapshot.
import fs from 'node:fs';
import net from 'node:net';
import {isDeepStrictEqual} from 'node:util';
import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!==`/${container}`||!info.Config.Image.includes('supabase/postgres')||!info.State.Running)throw Error('Local guard failed');
const sql=input=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true});
const baseline=JSON.parse(fs.readFileSync('docs/MODULE_5_LOCAL_CATALOG.json','utf8'));
const output=sql(fs.readFileSync('docs/MODULE_5_CATALOG_PREFLIGHT.sql','utf8'));
const current=JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{"tables"')));
const results=[];
function check(name,pass){results.push({name,pass:!!pass});if(!pass)throw Error('Independent local restoration check failed');}
for(const key of ['tables','columns','constraints','indexes','policies','grants','column_acl_count','triggers','storage_tables','storage_policies','buckets','aggregates','last_migration'])check('original '+key+' restored',isDeepStrictEqual(current[key],baseline[key]));
const residue=JSON.parse(sql("SELECT json_build_object('ledger_absent',to_regclass('public.property_media_operations') IS NULL,'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'bedos_media_%'),'auth_fixtures',(SELECT count(*) FROM auth.users WHERE email LIKE 'media-live-%@bedos-media-live.invalid' OR email LIKE '%@bedos-media-test.invalid'),'properties',(SELECT count(*) FROM public.properties WHERE slug LIKE 'media-live-%' OR slug LIKE 'bedos-media-%'),'temporary_buckets',(SELECT count(*) FROM storage.buckets WHERE id LIKE 'media-live-%'));"));
check('operation ledger absent',residue.ledger_absent);
for(const key of ['functions','auth_fixtures','properties','temporary_buckets'])check('zero remaining '+key,residue[key]===0);
await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(55330,'127.0.0.1',()=>server.close(resolve));});check('test server port free',true);
const report={date:new Date().toISOString(),scope:'Independent local read-only schema/Storage configuration and fixture/port cleanup verification',results};
fs.writeFileSync('docs/module-5-evidence/local-media-cleanup.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.pass).length,results}));
