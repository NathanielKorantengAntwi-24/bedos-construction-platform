// Actual local Next.js HTTP, Auth, PostgREST/RLS and concurrent RPC verification.
// Never reads hosted credentials. All targets are guarded loopback/local Docker.
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import {execFileSync,spawn} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
const container='supabase_db_bedos-supabase-lab',authContainer='supabase_auth_bedos-supabase-lab';
const inspect=n=>JSON.parse(execFileSync('docker',['inspect',n],{encoding:'utf8',windowsHide:true}))[0];
const db=inspect(container),auth=inspect(authContainer);
const env=new Map(auth.Config.Env.map(x=>{const at=x.indexOf('=');return [x.slice(0,at),x.slice(at+1)];}));
if(db.Name!==`/${container}`||!db.Config.Image.includes('supabase/postgres')||!env.get('GOTRUE_DB_DATABASE_URL')?.includes(container)||!env.get('GOTRUE_JWT_SECRET'))throw Error('Local lab guard failed');
const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
const quote=s=>`'${s.replaceAll("'","''")}'`;
const json=q=>JSON.parse(sql(q));
const base='http://127.0.0.1:55321',origin='http://127.0.0.1:55330';
function jwt(role){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `${h}.${p}.`+crypto.createHmac('sha256',env.get('GOTRUE_JWT_SECRET')).update(`${h}.${p}`).digest('base64url');}
const anonKey=jwt('anon'),serviceKey=jwt('service_role'),options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(base,serviceKey,options),anonymous=createClient(base,anonKey,options);
const run=crypto.randomUUID(),prefix=`property-live-${run}`,fixtures=[],results=[];
let psDirectory,helperChecks=0;
let stage='preflight',installed=false,seeded=false,server,serverLog;
const check=(name,pass)=>{stage=name;results.push({name,pass:!!pass});if(!pass)throw Error('Local property check failed');};
const source=['20261101040000_secure_service_catalog.sql','20261101060000_secure_property_management.sql','20261101070000_restrict_property_writes.sql'].map(n=>fs.readFileSync('supabase/migrations/'+n,'utf8')).join('\n');
const names=[...source.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)].map(x=>x[1]);
const functions=()=>json(`SELECT coalesce(json_agg(json_build_object('name',p.proname,'body',p.prosrc,'identity',pg_get_function_identity_arguments(p.oid)) ORDER BY p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${names.map(quote)});`);
const helperQuery="SELECT json_build_object('definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl::text) FROM pg_proc WHERE oid='public.get_user_role()'::regprocedure;";
const originalHelper=json(helperQuery);
const grantsQuery="SELECT coalesce(json_agg(json_build_object('table',table_name,'role',grantee,'privilege',privilege_type,'grantable',is_grantable) ORDER BY table_name,grantee,privilege_type),'[]') FROM information_schema.table_privileges WHERE table_schema='public' AND table_name IN ('properties') AND grantee IN ('PUBLIC','anon','authenticated','service_role');";
const originalGrants=json(grantsQuery);
const permissionsQuery="SELECT coalesce(json_agg(json_build_object('id',id,'name',name) ORDER BY name),'[]') FROM public.permissions WHERE name IN ('properties.view','properties.manage');";
const originalPermissions=json(permissionsQuery);
const mappingsQuery="SELECT coalesce(json_agg(json_build_object('role_id',rp.role_id,'permission_id',rp.permission_id) ORDER BY rp.role_id,rp.permission_id),'[]') FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id WHERE p.name IN ('properties.view','properties.manage');";
const originalMappings=json(mappingsQuery);
const originalConstraint=sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.properties'::regclass AND conname='properties_status_check';");
const jar=()=>new Map();
async function api(path,method='GET',body,session){
 if(!path.startsWith('/api/'))throw Error('Local API path guard failed');
 const response=await fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(45000),headers:{Connection:'close',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(session?.size?{Cookie:[...session].map(([k,v])=>`${k}=${v}`).join('; ')}:{})},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
 if(session)for(const raw of response.headers.getSetCookie()){const pair=raw.split(';')[0],at=pair.indexOf('=');if(/max-age=0/i.test(raw))session.delete(pair.slice(0,at));else session.set(pair.slice(0,at),pair.slice(at+1));}
 let data;try{data=await response.json();}catch{data=null;}
 return {status:response.status,data,cache:response.headers.get('cache-control')};
}
async function fixture(label,role){
 const email=`${prefix}-${label}@bedos-property-live.invalid`,name=`Local property ${run} ${label}`,password=crypto.randomBytes(24).toString('base64url')+'aA1!';
 const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name}});
 const f={id:r.data.user?.id,email,name,password,role,jar:jar()};if(f.id)fixtures.push(f);
 check(`${label} exact local Auth fixture`,!r.error&&!!f.id&&r.data.user.email===email);
 sql(`UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name=${quote(role)}),account_status='active' WHERE id=${quote(f.id)};`);
 const login=await api('/api/auth/login','POST',{email,password},f.jar);check(`${label} actual backend login`,login.status===200&&login.data.user.id===f.id);
 return f;
}
try {
 check('temporary functions absent before test',functions().length===0);
 await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(55330,'127.0.0.1',()=>probe.close(resolve));});
 seeded=true;
 sql(`BEGIN;INSERT INTO public.permissions(name) VALUES('properties.view'),('properties.manage') ON CONFLICT(name) DO NOTHING;
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.name IN ('administrator','content_manager') AND p.name IN ('properties.view','properties.manage') ON CONFLICT DO NOTHING;
 ${fs.readFileSync('supabase/migrations/20261029000000_restrict_role_lookup_to_active_accounts.sql','utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'')}
 COMMIT;`);
 installed=true;sql(source);
 fs.mkdirSync('node_modules/.cache',{recursive:true});serverLog=fs.openSync(`node_modules/.cache/property-live-${run}.log`,'w');
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','55330'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:base,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:anonKey,SUPABASE_SERVICE_ROLE_KEY:serviceKey,BEDOS_APP_ORIGIN:origin,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore',serverLog,serverLog]});
 const deadline=Date.now()+90000;let ready=false;
 while(Date.now()<deadline){if(server.exitCode!==null)throw Error('Local Next server exited');try{const r=await api('/api/properties');if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,400));}
 check('local property API ready',ready);
 const owner=await fixture('admin','administrator'),staff=await fixture('content','content_manager'),customer=await fixture('customer','customer'),finance=await fixture('finance','finance');
 const input={title:`${prefix} %,(literal)`,slug:`${prefix}-house`,property_type:'house',listing_type:'sale',price:100,bedrooms:2,bathrooms:1,city:'Accra'};
 let r=await api('/api/properties','POST',input,staff.jar);check('content manager creates draft',r.status===201&&r.data.property.status==='draft'&&r.data.property.created_by===staff.id);const id=r.data.property.id;
 r=await api('/api/properties');check('public list hides draft and no-store',r.status===200&&!r.data.properties.some(x=>x.id===id)&&r.cache==='no-store');
 r=await api(`/api/properties/${id}`);check('anonymous draft detail hidden',r.status===404);
 r=await api(`/api/properties/${id}`,'GET',undefined,staff.jar);check('content manager draft preview',r.status===200&&r.data.property.id===id);
 for(const f of [customer,finance]){r=await api('/api/properties/manage','GET',undefined,f.jar);check(`${f.role} management denied`,r.status===403);}
 r=await api('/api/properties/manage');check('anonymous management denied',r.status===401);
 r=await api(`/api/properties/${id}`,'PATCH',{status:'published'},owner.jar);check('ordinary edit cannot publish',r.status===400);
 r=await api(`/api/properties/${id}/status`,'PATCH',{status:'published',expected_status:'draft',reason:'Local publish verification'},staff.jar);check('explicit publication succeeds',r.status===200&&r.data.property.status==='published');
 r=await api(`/api/properties/${id}/status`,'PATCH',{status:'archived',expected_status:'draft',reason:'Stale change'},owner.jar);check('stale lifecycle denied',r.status===409);
 r=await api(`/api/properties/${id}`);check('public detail exact projection',r.status===200&&Object.keys(r.data.property).length===20&&!('created_by' in r.data.property)&&r.cache==='no-store');
 r=await api('/api/properties?'+new URLSearchParams({search:'%,(literal)',min_price:'100',max_price:'100',min_bedrooms:'2',max_bathrooms:'1',city:'Accra'}));check('combined literal filters',r.status===200&&r.data.properties.some(x=>x.id===id));
 for(const query of ['limit=101','page=1&page=2','status=draft','min_price=101&max_price=100']){r=await api('/api/properties?'+query);check('strict query '+query,r.status===400&&r.cache==='no-store');}
 r=await api('/api/properties','POST','{',owner.jar);check('malformed JSON safe',r.status===400);
 const direct=await admin.from('properties').update({title:'Must not bypass audit'}).eq('id',id);check('service direct writes denied',direct.error?.code==='42501');
 const directRpc=await anonymous.rpc('bedos_mutate_property',{p_actor_id:owner.id,p_action:'delete',p_id:id,p_input:{}});check('anonymous privileged RPC denied',!!directRpc.error);
 const concurrent=await Promise.all(['reserved','unavailable'].map(status=>api(`/api/properties/${id}/status`,'PATCH',{status,expected_status:'published',reason:'Concurrent lifecycle verification'},owner.jar)));
 check('one concurrent transition wins and one is stale',concurrent.filter(x=>x.status===200).length===1&&concurrent.filter(x=>x.status===409).length===1);
 const winner=concurrent.find(x=>x.status===200).data.property.status;
 r=await api(`/api/properties/${id}`);check('unpublished after transition',r.status===404);
 r=await api(`/api/properties/${id}/status`,'PATCH',{status:'published',expected_status:winner,reason:'Restore local publication'},owner.jar);check('publication restored',r.status===200);

 // Hold an uncommitted withdrawal while a new reference tries to insert.
 const lockSql=`BEGIN;UPDATE public.properties SET status='draft' WHERE id=${quote(id)};SELECT pg_sleep(3) /* ${prefix}-guard */;COMMIT;`;
 const locker=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1','-c',lockSql],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const finished=new Promise((resolve,reject)=>{locker.on('error',reject);locker.on('exit',code=>code===0?resolve():reject(Error('Guard lock session failed')));});
 let waiting=false;for(let n=0;n<30;n++){if(sql(`SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE ${quote('%'+prefix+'-guard%')} AND wait_event='PgSleep';`)==='1'){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,50));}
 check('concurrent withdrawal lock established',waiting);
 const raced=await admin.from('viewing_requests').insert({property_id:id,customer_id:customer.id});await finished;
 check('reference waits and rejects committed withdrawal',raced.error?.code==='P0409');
 const racedEnquiry=await admin.from('enquiries').insert({enquiry_type:'property_enquiry',property_id:id});check('withdrawn enquiry denied by guard',racedEnquiry.error?.code==='P0409');
 r=await api(`/api/properties/${id}/status`,'PATCH',{status:'published',expected_status:'draft',reason:'Restore after guard verification'},owner.jar);check('publication restored after guard test',r.status===200);
 r=await api(`/api/properties/${id}`,'DELETE',undefined,staff.jar);check('content manager deletion denied',r.status===403);
 sql(`INSERT INTO public.property_images(property_id,storage_path) VALUES(${quote(id)},${quote(prefix+'/not-an-upload')});`);
 r=await api(`/api/properties/${id}`,'DELETE',undefined,owner.jar);check('media protects parent deletion',r.status===409);
 sql(`DELETE FROM public.property_images WHERE property_id=${quote(id)} AND storage_path=${quote(prefix+'/not-an-upload')};`);
 r=await api(`/api/properties/${id}`,'DELETE',undefined,owner.jar);check('administrator deletes exact property',r.status===200&&r.data.property_id===id);
 check('exact successful mutations audited',sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id=${quote(id)} AND action IN ('property_created','property_status_changed','property_deleted');`)==='6');
 stage='local PowerShell workflow';
 psDirectory=`${process.cwd().replaceAll('\\','/')}/.next/property-ps-${run}`;fs.mkdirSync(psDirectory,{recursive:true});
 const psQuote=s=>"'"+s.replaceAll("'","''")+"'";
 let ps=fs.readFileSync('scripts/Test-ProductionPropertyManagement.ps1','utf8');
 ps=ps.replace("$root=Split-Path $PSScriptRoot -Parent",`$root=${psQuote(process.cwd())}`)
  .replace("$directory=Join-Path $root 'docs/module-4-evidence'",`$directory=${psQuote(psDirectory)}`)
  .replace(". (Join-Path $PSScriptRoot 'lib/ProductionVerification.ps1')",`. ${psQuote(process.cwd()+'/scripts/lib/ProductionVerification.ps1')}`)
  .replaceAll('https://bedos-construction-platform.vercel.app',origin).replaceAll('https://zjdqomckldeipigqqfqm.supabase.co',base);
 if(ps.includes('https://bedos-construction-platform.vercel.app')||ps.includes('https://zjdqomckldeipigqqfqm.supabase.co'))throw Error('Local PowerShell destination guard failed');
 ps=`function Read-Host { param([string]$Prompt,[switch]$AsSecureString) if($AsSecureString){$value=New-Object System.Security.SecureString;foreach($character in $env:BEDOS_PROPERTY_LOCAL_PASSWORD.ToCharArray()){$value.AppendChar($character)};$value.MakeReadOnly();return $value};return $env:BEDOS_PROPERTY_LOCAL_EMAIL }\n`+ps;
 fs.writeFileSync(psDirectory+'/verify.ps1',ps);
 const psEnv={...process.env,BEDOS_PROPERTY_LOCAL_EMAIL:owner.email,BEDOS_PROPERTY_LOCAL_PASSWORD:owner.password};
 // Let Windows PowerShell 5 resolve its own standard modules, rather than inherit
 // PowerShell 7's module search paths through this Node process.
 for(const key of Object.keys(psEnv))if(key.toLowerCase()==='psmodulepath')delete psEnv[key];
 const psOutput=execFileSync('powershell.exe',['-NoProfile','-File',psDirectory+'/verify.ps1'],{env:psEnv,encoding:'utf8',windowsHide:true,timeout:90000,stdio:['ignore','pipe','pipe']});
 fs.writeFileSync(psDirectory+'/console.txt',psOutput);
 const psReport=JSON.parse(fs.readFileSync(psDirectory+'/production-property-admin.json','utf8').replace(/^\uFEFF/,''));
 const psJournal=JSON.parse(fs.readFileSync(psDirectory+'/private-property-fixtures.json','utf8').replace(/^\uFEFF/,''));
 helperChecks=psReport.results.length;
 check('production PowerShell workflow passes against guarded local origin',helperChecks>30&&psReport.results.every(x=>x.pass));
 check('PowerShell workflow removes both exact property fixtures',psJournal.state==='complete'&&psJournal.fixtures.length===2&&psJournal.fixtures.every(x=>x.state==='deleted'));
 check('PowerShell workflow signs administrator out',psReport.results.some(x=>x.name==='Administrator logout'&&x.http_status===200));
 for(const f of fixtures){r=await api('/api/auth/logout','POST',{},f.jar);check(`${f.role} logout`,r.status===200);}
} catch(error) {results.push({name:'Local property integration stopped',pass:false,stage,error_type:error.name});}
finally {
 if(server){server.kill();await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,5000);});}if(serverLog!==undefined)fs.closeSync(serverLog);
 try {
  for(const f of fixtures){const r=await admin.auth.admin.getUserById(f.id);if(r.error||r.data.user?.email!==f.email||r.data.user.user_metadata?.full_name!==f.name)throw Error('Exact fixture identity guard failed');}

  if(psDirectory&&fs.existsSync(psDirectory+'/private-property-fixtures.json')){
   const journal=JSON.parse(fs.readFileSync(psDirectory+'/private-property-fixtures.json','utf8').replace(/^\uFEFF/,''));
   if(!fixtures.some(f=>f.id===journal.actor))throw Error('PowerShell actor guard failed');
   for(const f of journal.fixtures){
    if(!/^bedos-property-[a-f0-9]{32}-/.test(f.slug)||!f.title.startsWith('Temporary verification '))throw Error('PowerShell fixture guard failed');
    const rows=json(`SELECT coalesce(json_agg(t),'[]') FROM (SELECT id,title,slug,created_by FROM public.properties WHERE slug=${quote(f.slug)}) t;`);
    if(rows.some(x=>x.title!==f.title||x.created_by!==journal.actor||(f.id&&f.id!==x.id)))throw Error('PowerShell exact identity guard failed');
    if(rows.length)sql(`DELETE FROM public.properties WHERE id=${quote(rows[0].id)} AND slug=${quote(f.slug)};`);
   }
  }
  const ids=fixtures.map(f=>quote(f.id)).join(',');
  if(Number(sql(`SELECT count(*) FROM public.properties WHERE slug LIKE ${quote(prefix+'%')} AND (created_by IS NULL OR created_by NOT IN (${ids||'NULL'}));`)))throw Error('Content ownership cleanup guard failed');
  sql(`BEGIN;DELETE FROM public.property_images WHERE property_id IN (SELECT id FROM public.properties WHERE slug LIKE ${quote(prefix+'%')}) AND storage_path=${quote(prefix+'/not-an-upload')};DELETE FROM public.properties WHERE slug LIKE ${quote(prefix+'%')};${ids?`DELETE FROM public.audit_logs WHERE actor_id IN (${ids});`:''}COMMIT;`);
  for(const f of fixtures){const r=await admin.auth.admin.deleteUser(f.id);check('exact Auth fixture removed',!r.error);}
  check('local property fixtures absent',sql(`SELECT (SELECT count(*) FROM auth.users WHERE email LIKE ${quote(prefix+'%@bedos-property-live.invalid')})+(SELECT count(*) FROM public.properties WHERE slug LIKE ${quote(prefix+'%')});`)==='0');
 }catch{results.push({name:'Fixture cleanup needs controlled review',pass:false});fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/property-local-cleanup.json',JSON.stringify({prefix,fixtures:fixtures.map(({id,email,name})=>({id,email,name}))}));}
 try {
  if(installed||seeded){
   const current=functions();if(installed)check('temporary function bodies match installed source',current.length===names.length&&current.every(f=>{const part=source.slice(source.indexOf(`CREATE FUNCTION public.${f.name}(`));return f.body.replace(/\s+/g,'')===part.split('$function$')[1].replace(/\s+/g,'');}));
   sql(`BEGIN;SET LOCAL lock_timeout='5s';DROP TRIGGER IF EXISTS viewing_property_publication_guard ON public.viewing_requests;DROP TRIGGER IF EXISTS enquiry_property_publication_guard ON public.enquiries;${current.map(f=>`DROP FUNCTION public.${f.name}(${f.identity});`).join('\n')}
   ALTER TABLE public.properties DROP CONSTRAINT properties_status_check;ALTER TABLE public.properties ADD CONSTRAINT properties_status_check ${originalConstraint};
   REVOKE ALL ON public.properties FROM PUBLIC,anon,authenticated,service_role;
   ${originalGrants.map(g=>`GRANT ${g.privilege} ON public.${g.table} TO ${g.role==='PUBLIC'?'PUBLIC':'"'+g.role+'"'}${g.grantable==='YES'?' WITH GRANT OPTION':''};`).join('\n')}
   ${originalHelper.definition};DELETE FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE name IN ('properties.view','properties.manage'));
   ${originalMappings.map(m=>`INSERT INTO public.role_permissions(role_id,permission_id) VALUES(${quote(m.role_id)},${quote(m.permission_id)});`).join('\n')}
   DELETE FROM public.permissions WHERE name IN ('properties.view','properties.manage') ${originalPermissions.length?`AND id NOT IN (${originalPermissions.map(p=>quote(p.id))})`:''};COMMIT;NOTIFY pgrst,'reload schema';`);
   check('original grants restored',JSON.stringify(json(grantsQuery))===JSON.stringify(originalGrants));
   check('original helper restored',JSON.stringify(json(helperQuery))===JSON.stringify(originalHelper));
   check('original permissions restored',JSON.stringify(json(permissionsQuery))===JSON.stringify(originalPermissions)&&JSON.stringify(json(mappingsQuery))===JSON.stringify(originalMappings));
   check('temporary functions removed',functions().length===0);
  }
 }catch{results.push({name:'Dependency restoration needs controlled review',pass:false});}
 const report={date:new Date().toISOString(),production_helper_local_assertions:helperChecks,scope:'Local loopback Next/Auth/PostgREST/RLS/concurrency; no hosted credentials, no production changes',results};fs.mkdirSync('docs/module-4-evidence',{recursive:true});fs.writeFileSync('docs/module-4-evidence/local-property-integration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(results.some(x=>!x.pass))process.exitCode=1;
}
