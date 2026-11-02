// Independent read-only local catalog/process/fixture checks. No hosted credentials.
import fs from 'node:fs';import net from 'node:net';import {execFileSync} from 'node:child_process';
const c='supabase_db_bedos-supabase-lab',info=JSON.parse(execFileSync('docker',['inspect',c],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!=='/'+c||!info.Config.Image.includes('supabase/postgres')||!info.State.Running)throw Error('Local database guard');
const sql=input=>execFileSync('docker',['exec','-i',c,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
const files=fs.readdirSync('node_modules/.cache/module7').filter(n=>n.endsWith('-baseline.json')).sort((a,b)=>fs.statSync('node_modules/.cache/module7/'+b).mtimeMs-fs.statSync('node_modules/.cache/module7/'+a).mtimeMs);
if(!files.length)throw Error('Persisted pre-run baseline missing');const original=JSON.parse(fs.readFileSync('node_modules/.cache/module7/'+files[0],'utf8'));
const sections=raw=>Object.fromEntries(raw.replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.includes('|')).map(l=>{const i=l.indexOf('|');return [l.slice(0,i),JSON.parse(l.slice(i+1))]}));
const expected=sections(original.originalCatalog),actual=sections(sql(fs.readFileSync('scripts/MODULE_7_READONLY_REVIEW.sql','utf8'))),results=[];
const check=(name,pass)=>results.push({name,pass:!!pass});for(const [k,v] of Object.entries(expected))check('Original '+k+' restored',JSON.stringify(v)===JSON.stringify(actual[k]));
check('Original role helper restored',sql("SELECT pg_get_functiondef('public.get_user_role()'::regprocedure);")===original.helper);
const source=['20261101040000_secure_service_catalog.sql','20261102030000_secure_construction_projects.sql'].map(n=>fs.readFileSync('supabase/migrations/'+n,'utf8')).join('\n');const names=[...source.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)].map(m=>"'"+m[1]+"'");
check('Temporary construction and catalog functions absent',sql(`SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(${names});`)==='0');
check('Temporary project tables absent',sql("SELECT (to_regclass('public.project_categories') IS NULL AND to_regclass('public.project_services') IS NULL AND to_regclass('public.project_media_operations') IS NULL)::text;")==='true');
check('Temporary failure triggers absent',sql("SELECT count(*) FROM pg_trigger WHERE tgname IN('m7_local_fail','m7_rollback_audit_failure');")==='0');
check('Exact local Auth fixtures absent',sql("SELECT count(*) FROM auth.users WHERE email LIKE 'project-local-%@module7.invalid' OR email LIKE '%@module7-sql.invalid';")==='0');
check('Temporary service fixtures absent',sql("SELECT count(*) FROM public.services WHERE slug LIKE 'project-local-%' OR slug LIKE 'linked-service-%';")==='0');
check('Local test server stopped',await new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(55330,'127.0.0.1',()=>s.close(()=>resolve(true)));}));
fs.writeFileSync('docs/module-7-evidence/local-project-cleanup.json',JSON.stringify({date:new Date().toISOString(),scope:'Independent read-only checks against persisted corrected-run baseline; historical helper restoration previously approved separately',results},null,2)+'\n');console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.pass)}));if(results.some(r=>!r.pass))process.exitCode=1;
