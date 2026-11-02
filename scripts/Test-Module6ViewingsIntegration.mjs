// Module 6: real loopback Next/Auth/PostgREST and committing concurrency/failure checks.
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
const run=crypto.randomUUID(),prefix=`viewing-live-${run}`,fixtures=[],results=[];

let stage='preflight',installed=false,seeded=false,server,serverLog;
const check=(name,pass)=>{stage=name;results.push({name,pass:!!pass});if(!pass)throw Error('Local viewing check failed');};
const catalogInput=fs.readFileSync('docs/MODULE_6_CATALOG_PREFLIGHT.sql','utf8');
const catalog=()=>JSON.parse(sql(catalogInput).split('\n').find(l=>l.startsWith('{')));const originalCatalog=catalog();
const source=['20261030010000_add_admin_user_reads.sql','20261101040000_secure_service_catalog.sql','20261101060000_secure_property_management.sql','20261101070000_restrict_property_writes.sql','20261102010000_secure_property_viewings.sql','20261102020000_restrict_property_viewing_writes.sql'].map(n=>fs.readFileSync('supabase/migrations/'+n,'utf8')).join('\n');
const names=[...source.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)].map(x=>x[1]);
const functions=()=>json(`SELECT coalesce(json_agg(json_build_object('name',p.proname,'body',p.prosrc,'identity',pg_get_function_identity_arguments(p.oid)) ORDER BY p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${names.map(quote)});`);
const helperQuery="SELECT json_build_object('definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl::text) FROM pg_proc WHERE oid='public.get_user_role()'::regprocedure;";
const originalHelper=json(helperQuery);
const grantsQuery="SELECT coalesce(json_agg(json_build_object('table',table_name,'role',grantee,'privilege',privilege_type,'grantable',is_grantable) ORDER BY table_name,grantee,privilege_type),'[]') FROM information_schema.table_privileges WHERE table_schema='public' AND table_name IN ('properties','viewing_requests') AND grantee IN ('PUBLIC','anon','authenticated','service_role');";
const originalGrants=json(grantsQuery);
const permissionsQuery="SELECT coalesce(json_agg(json_build_object('id',id,'name',name) ORDER BY name),'[]') FROM public.permissions WHERE name IN ('properties.view','properties.manage','viewings.view','viewings.manage','users.view');";
const originalPermissions=json(permissionsQuery);
const mappingsQuery="SELECT coalesce(json_agg(json_build_object('role_id',rp.role_id,'permission_id',rp.permission_id) ORDER BY rp.role_id,rp.permission_id),'[]') FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id WHERE p.name IN ('properties.view','properties.manage','viewings.view','viewings.manage','users.view');";
const originalMappings=json(mappingsQuery);
const originalViewingConstraint=sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.viewing_requests'::regclass AND conname='viewing_requests_status_check';");
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
 const email=`${prefix}-${label}@bedos-viewing-live.invalid`,name=`Local viewing ${run} ${label}`,password=crypto.randomBytes(24).toString('base64url')+'aA1!';
 const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name}});
 const f={id:r.data.user?.id,email,name,password,role,jar:jar()};if(f.id)fixtures.push(f);
 check(`${label} exact local Auth fixture`,!r.error&&!!f.id&&r.data.user.email===email);
 sql(`UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name=${quote(role)}),account_status='active' WHERE id=${quote(f.id)};`);
 const login=await api('/api/auth/login','POST',{email,password},f.jar);check(`${label} actual backend login`,login.status===200&&login.data.user.id===f.id);
 return f;
}
const requests=[],properties=[];let psDirectory,helperChecks=0;let helperFixtures=[],helperEvents=[];
const countAudits=id=>Number(sql(`SELECT count(*) FROM public.audit_logs WHERE entity_type='viewing_request' AND entity_id=${quote(id)};`));
const countEvents=id=>Number(sql(`SELECT count(*) FROM public.viewing_notification_events WHERE viewing_id=${quote(id)};`));
function holdProfile(id,status){
 const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let readyResolve,readyReject,doneResolve,doneReject,buffer='';const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j;}),done=new Promise((r,j)=>{doneResolve=r;doneReject=j;});
 child.stdout.on('data',b=>{buffer+=b.toString();if(buffer.includes('profile_locked'))readyResolve();});child.once('error',e=>{readyReject(e);doneReject(e);});child.once('exit',code=>{if(code===0)doneResolve();else{readyReject(Error('Local profile lock failed'));doneReject(Error('Local profile lock failed'));}});
 child.stdin.end(`BEGIN;UPDATE public.profiles SET account_status=${quote(status)} WHERE id=${quote(id)};SELECT 'profile_locked';SELECT pg_sleep(1.5);COMMIT;`);return {ready,done};
}
try {
 check('temporary functions absent',functions().length===0);
 check('local viewing fixture baseline empty',originalCatalog.aggregates.viewings===0&&originalCatalog.aggregates.viewing_notifications===0);
 await new Promise((resolve,reject)=>{const p=net.createServer();p.once('error',reject);p.listen(55330,'127.0.0.1',()=>p.close(resolve));});
 seeded=true;sql(`BEGIN;INSERT INTO public.permissions(name) VALUES('properties.view'),('properties.manage'),('viewings.view'),('viewings.manage'),('users.view') ON CONFLICT(name) DO NOTHING;
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE (r.name IN('administrator','content_manager') AND p.name IN('properties.view','properties.manage')) OR (r.name IN('administrator','sales_customer_service') AND p.name IN('viewings.view','viewings.manage')) OR (r.name='administrator' AND p.name='users.view') ON CONFLICT DO NOTHING;
 ${fs.readFileSync('supabase/migrations/20261029000000_restrict_role_lookup_to_active_accounts.sql','utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'')}COMMIT;`);
 installed=true;sql(source);
 fs.mkdirSync('node_modules/.cache',{recursive:true});serverLog=fs.openSync(`node_modules/.cache/viewing-live-${run}.log`,'w');
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','55330'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:base,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:anonKey,SUPABASE_SERVICE_ROLE_KEY:serviceKey,BEDOS_APP_ORIGIN:origin,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore',serverLog,serverLog]});
 let ready=false;const deadline=Date.now()+90000;while(Date.now()<deadline){if(server.exitCode!==null)throw Error('Local Next exited');try{const r=await api('/api/viewing-requests');if(r.status===401){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,400));}check('real Next viewing routes ready',ready);
 const owner=await fixture('administrator','administrator'),sales=await fixture('sales','sales_customer_service'),customer=await fixture('customer','customer'),other=await fixture('other','customer'),finance=await fixture('finance','finance'),content=await fixture('content','content_manager');
 let r=await api('/api/properties','POST',{title:'Temporary '+prefix,slug:prefix,property_type:'verification',listing_type:'verification'},owner.jar);check('exact local property created',r.status===201&&r.data.property.slug===prefix);const property=r.data.property.id;properties.push(property);
 r=await api(`/api/properties/${property}/status`,'PATCH',{status:'published',expected_status:'draft',reason:'Local viewing fixture'},owner.jar);check('exact property published',r.status===200);
 const collection=`/api/properties/${property}/viewing-requests`;
 r=await api(collection,'POST',{preferred_date:'2027-01-15',message:'Local viewing preference'},customer.jar);check('customer creates viewing through real backend',r.status===201&&r.data.data.status==='new'&&r.data.data.version===1);const id=r.data.data.id;requests.push(id);const item=collection+'/'+id;
 check('request actor and three durable event records bound',r.data.data.customer_id===customer.id&&countAudits(id)===1&&countEvents(id)===3);
 check('central notifications materialize after business commit',sql(`SELECT count(*) FROM public.viewing_notification_events WHERE viewing_id=${quote(id)} AND state='recorded';`)==='3'&&sql(`SELECT count(*) FROM public.notifications WHERE related_entity_id=${quote(id)};`)==='3');
 r=await api('/api/viewing-requests', 'GET',undefined,customer.jar);check('customer own bounded list and safe projection',r.status===200&&r.data.data.length===1&&r.data.pagination.total===1&&Object.keys(r.data.data[0]).sort().join(',')==='assigned_to,created_at,customer_id,id,message,preferred_date,preferred_time,property_id,status,updated_at,version'&&r.cache==='no-store');
 r=await api('/api/viewing-requests','GET',undefined,other.jar);check('other customer list isolated',r.status===200&&r.data.pagination.total===0);
 r=await api(item,'GET',undefined,other.jar);check('foreign detail hidden',r.status===404);
 for(const f of [finance,content]){r=await api('/api/viewing-requests','GET',undefined,f.jar);check(`${f.role} viewing read denied`,r.status===403);}
 r=await api(collection,'GET',undefined,customer.jar);check('property management list staff-only',r.status===403);
 r=await api(collection+'?limit=1&page=2','GET',undefined,sales.jar);check('staff empty next page keeps exact count',r.status===200&&r.data.data.length===0&&r.data.pagination.total===1);
 r=await api('/api/viewing-requests?customer_id='+other.id,'GET',undefined,customer.jar);check('customer cannot choose foreign customer filter',r.status===400);
 r=await api(collection,'POST','broken');check('anonymous mutation rejected before malformed JSON',r.status===401);
 for(const body of [{preferred_date:'2026-02-29'},{preferred_time:'24:00'},{message:2},{customer_id:other.id}]){r=await api(collection,'POST',body,customer.jar);check('strict malformed viewing fields rejected',r.status===400);}
 r=await api(collection,'POST','"'+'x'.repeat(16384)+'"',customer.jar);check('streamed viewing JSON body capped',r.status===413);
 r=await api(item,'PATCH',{message:'Missing precondition'},customer.jar);check('edit requires version',r.status===400);
 const directCustomer=createClient(base,anonKey,options),directSales=createClient(base,anonKey,options);
 check('direct-client fixture authentication',!(await directCustomer.auth.signInWithPassword({email:customer.email,password:customer.password})).error&&!(await directSales.auth.signInWithPassword({email:sales.email,password:sales.password})).error);
 check('customer direct insert bypass denied',!!(await directCustomer.from('viewing_requests').insert({property_id:property,customer_id:customer.id})).error);
 check('sales direct immutable-field bypass denied',!!(await directSales.from('viewing_requests').update({status:'completed',customer_id:other.id}).eq('id',id)).error);
 check('privileged direct writes also denied',!!(await admin.from('viewing_requests').update({status:'completed'}).eq('id',id)).error);

 r=await api(item,'PATCH',{expected_version:1,message:'Edited locally'},customer.jar);check('customer own new edit succeeds',r.status===200&&r.data.data.version===2);
 r=await api(item,'PATCH',{expected_version:1,message:'Stale'},customer.jar);check('stale edit produces conflict',r.status===409&&countAudits(id)===2);
 const races=await Promise.all([api(item,'PATCH',{expected_version:2,status:'contacted',assigned_to:sales.id},owner.jar),api(item,'PATCH',{expected_version:2,status:'contacted',assigned_to:owner.id},sales.jar)]);
 check('simultaneous staff writes commit only one expected version',races.filter(r=>r.status===200).length===1&&races.filter(r=>r.status===409).length===1&&countAudits(id)===3);
 r=await api(item,'PATCH',{expected_version:3,message:'Late customer edit'},customer.jar);check('customer editing ends after staff processing',r.status===403);
 r=await api(item,'PATCH',{expected_version:3,status:'scheduled'},owner.jar);check('scheduling requires complete confirmed preferences',r.status===400);
 r=await api(`/api/properties/${property}`,'DELETE',undefined,owner.jar);check('property deletion protects existing viewing',r.status===409);
 r=await api(`/api/properties/${property}/status`,'PATCH',{status:'unavailable',expected_status:'published',reason:'Local viewing withdrawal'},owner.jar);check('property withdrawal succeeds',r.status===200);
 r=await api(collection,'POST',{},other.jar);check('withdrawn property refuses new viewing',r.status===409);
 r=await api(item,'GET',undefined,customer.jar);check('existing customer viewing survives withdrawal',r.status===200);
 r=await api(item,'PATCH',{expected_version:3,status:'scheduled',preferred_time:'12:30',assigned_to:sales.id},owner.jar);check('existing viewing schedules with active assignee and civil time',r.status===200&&r.data.data.version===4&&r.data.data.status==='scheduled'&&r.data.data.preferred_time==='12:30:00');
 let lock=holdProfile(sales.id,'suspended');await lock.ready;r=await api(item,'PATCH',{expected_version:4,preferred_time:'13:00'},owner.jar);await lock.done;
 check('assignment eligibility rechecked after concurrent suspension',r.status===400&&countAudits(id)===4);sql(`UPDATE public.profiles SET account_status='active' WHERE id=${quote(sales.id)};`);
 lock=holdProfile(customer.id,'suspended');await lock.ready;r=await api(item,'GET',undefined,customer.jar);await lock.done;check('existing customer session denied after concurrent suspension',r.status===403);const suspendedRead=await directCustomer.from('viewing_requests').select('id').eq('id',id);check('direct PostgREST read blocks suspended customer session',!suspendedRead.error&&suspendedRead.data.length===0);sql(`UPDATE public.profiles SET account_status='active' WHERE id=${quote(customer.id)};`);const restoredRead=await directCustomer.from('viewing_requests').select('id').eq('id',id);check('direct own read restored for active customer',!restoredRead.error&&restoredRead.data.length===1);await directCustomer.auth.signOut({scope:'local'});await directSales.auth.signOut({scope:'local'});
 sql(`CREATE FUNCTION public.bedos_viewing_local_notify_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.notification_type='viewing_scheduled' THEN RAISE EXCEPTION 'Local synthetic delivery failure' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;CREATE TRIGGER bedos_viewing_local_notify_fail BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.bedos_viewing_local_notify_fail();`);
 r=await api(item,'PATCH',{expected_version:4,preferred_time:'13:00'},owner.jar);check('reschedule commits despite notification failure',r.status===200&&r.data.data.version===5&&r.data.notifications_pending===true);
 const oldEvents=json(`SELECT json_agg(id) FROM public.viewing_notification_events WHERE viewing_id=${quote(id)} AND viewing_version=5 AND state='pending';`);check('two failed schedule events remain durable',oldEvents.length===2);
 r=await api(item,'PATCH',{expected_version:5,preferred_time:'14:00'},owner.jar);check('second reschedule supersedes old pending confirmation',r.status===200&&r.data.data.version===6&&r.data.notifications_pending===true);
 const newEvents=json(`SELECT json_agg(id) FROM public.viewing_notification_events WHERE viewing_id=${quote(id)} AND viewing_version=6 AND state='pending';`);
 r=await api(`/api/viewing-requests/notification-events/${oldEvents[0]}/retry`,'POST',{},owner.jar);check('manual retry respects cooldown',r.status===409);
 sql(`DROP TRIGGER bedos_viewing_local_notify_fail ON public.notifications;DROP FUNCTION public.bedos_viewing_local_notify_fail();UPDATE public.viewing_notification_events SET lease_until=now()-interval '1 minute' WHERE id IN (${[...oldEvents,...newEvents].map(quote)});`);
 for(const e of oldEvents){r=await api(`/api/viewing-requests/notification-events/${e}/retry`,'POST',{},owner.jar);check('obsolete schedule confirmation suppressed',r.status===200&&r.data.state==='suppressed');}
 for(const e of newEvents){r=await api(`/api/viewing-requests/notification-events/${e}/retry`,'POST',{},owner.jar);check('current schedule retry records notification',r.status===200&&r.data.state==='recorded');r=await api(`/api/viewing-requests/notification-events/${e}/retry`,'POST',{},owner.jar);check('successful retry replay is idempotent',r.status===200&&r.data.state==='recorded');}
 check('recorded current events each have exactly one notification',sql(`SELECT count(*) FROM public.notifications WHERE metadata->>'viewing_event_id' IN (${newEvents.map(quote)});`)==='2');
 r=await api('/api/viewing-requests/notification-events?limit=100','GET',undefined,owner.jar);check('administrator bounded safe event queue',r.status===200&&r.data.events.length>0&&r.data.events.every(e=>!('recipient_id'in e)&&!('lease_token'in e))&&r.cache==='no-store');
 r=await api('/api/viewing-requests/notification-events','GET',undefined,sales.jar);check('ordinary sales denied recovery queue',r.status===403);
 r=await api(`/api/viewing-requests/notification-events/${newEvents[0]}/retry`,'POST',{recipient_id:customer.id},owner.jar);check('recovery cannot choose recipients',r.status===400);
 r=await api(item,'PATCH',{expected_version:6,status:'cancelled'},sales.jar);check('staff cancellation succeeds',r.status===200&&r.data.data.version===7);
 r=await api(item,'PATCH',{expected_version:7,message:'Terminal edit'},owner.jar);check('terminal viewing immutable',r.status===409);
 r=await api(item+'?expected_version=6','DELETE',undefined,owner.jar);check('stale deletion rejected',r.status===409);
 r=await api(item+'?expected_version=7','DELETE',undefined,owner.jar);check('administrator exact versioned deletion',r.status===200);
 r=await api(item,'GET',undefined,customer.jar);check('deleted viewing hidden',r.status===404);
 r=await api(`/api/properties/${property}/status`,'PATCH',{status:'published',expected_status:'unavailable',reason:'Local fixture restoration'},owner.jar);check('property can republish after existing workflow',r.status===200);
 r=await api(collection,'POST',{},other.jar);check('second customer viewing accepted',r.status===201);const second=r.data.data.id;requests.push(second);
 r=await api(collection+'/'+second,'PATCH',{expected_version:1,status:'cancelled'},other.jar);check('owner cancels own new request',r.status===200&&r.data.data.version===2);
 r=await api(collection+'/'+second+'?expected_version=2','DELETE',undefined,owner.jar);check('second exact viewing deleted',r.status===200);

 psDirectory='.next/viewing-ps-'+run;fs.mkdirSync(psDirectory,{recursive:true});
 let ps=fs.readFileSync('scripts/Test-ProductionViewingManagement.ps1','utf8').replaceAll('https://bedos-construction-platform.vercel.app',origin).replaceAll('https://zjdqomckldeipigqqfqm.supabase.co',base).replaceAll('zjdqomckldeipigqqfqm','bedos-supabase-lab');
 ps=ps.replace(/\$root=Split-Path \$PSScriptRoot -Parent/,()=>'$root='+quote(process.cwd()));
 ps=ps.replace(/\$directory=Join-Path \$root 'docs\/module-6-evidence'/,()=>'$directory='+quote(process.cwd()+'/'+psDirectory));
 ps=ps.replace(/# BEGIN FIXTURE CONFIG[\s\S]*?# END FIXTURE CONFIG/,()=>'$config=@{NEXT_PUBLIC_SUPABASE_URL=$env:BEDOS_VIEWING_LOCAL_PROVIDER;SUPABASE_SERVICE_ROLE_KEY=$env:BEDOS_VIEWING_LOCAL_KEY};$linked=\'bedos-supabase-lab\'');
 ps=ps.replace("(Join-Path $PSScriptRoot 'lib/ProductionVerification.ps1')","(Join-Path $root 'scripts/lib/ProductionVerification.ps1')");
 ps='function Read-Host { param([string]$Prompt,[switch]$AsSecureString) if($AsSecureString){return ConvertTo-SecureString $env:BEDOS_VIEWING_LOCAL_PASSWORD -AsPlainText -Force};return $env:BEDOS_VIEWING_LOCAL_EMAIL }\n'+ps;
 fs.writeFileSync(psDirectory+'/verify.ps1',ps);
 const psEnv={...process.env,BEDOS_VIEWING_LOCAL_PROVIDER:base,BEDOS_VIEWING_LOCAL_KEY:serviceKey,BEDOS_VIEWING_LOCAL_EMAIL:owner.email,BEDOS_VIEWING_LOCAL_PASSWORD:owner.password};for(const key of Object.keys(psEnv))if(key.toLowerCase()==='psmodulepath')delete psEnv[key];
 const psOutput=execFileSync('powershell.exe',['-NoProfile','-File',psDirectory+'/verify.ps1'],{env:psEnv,encoding:'utf8',windowsHide:true,timeout:120000,stdio:['ignore','pipe','pipe']});fs.writeFileSync(psDirectory+'/console.txt',psOutput);
 const psReport=JSON.parse(fs.readFileSync(psDirectory+'/production-viewing-admin.json','utf8').replace(/^\uFEFF/,''));
 const psJournal=JSON.parse(fs.readFileSync(psDirectory+'/private-viewing-fixtures.json','utf8').replace(/^\uFEFF/,''));
 helperFixtures=psJournal.fixtures;helperEvents=psJournal.events;
 check('actual Windows PowerShell acceptance helper passes locally',psReport.results.length>=40&&psReport.results.every(r=>r.pass));helperChecks=psReport.results.length;
 check('PowerShell journal proves six exact fixtures removed',psJournal.actor===owner.id&&psJournal.state==='complete'&&helperFixtures.length===6&&helperFixtures.every(f=>f.state==='deleted'));
 check('PowerShell helper reconciles terminal notification events',helperEvents.length>0&&helperEvents.every(e=>['recorded','suppressed'].includes(e.state)));

 for(const f of fixtures){r=await api('/api/auth/logout','POST',{},f.jar);check(`${f.role} logout`,r.status===200);}
}catch(error){results.push({name:'Local viewing integration stopped',pass:false,stage,error_type:error.name});}
finally {
 if(server){server.kill();await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,5000);});}if(serverLog!==undefined)fs.closeSync(serverLog);
 try {
  sql('DROP TRIGGER IF EXISTS bedos_viewing_local_notify_fail ON public.notifications;DROP FUNCTION IF EXISTS public.bedos_viewing_local_notify_fail();');
  for(const f of fixtures){const r=await admin.auth.admin.getUserById(f.id);if(r.error||r.data.user?.email!==f.email||r.data.user.user_metadata?.full_name!==f.name)throw Error('Exact fixture guard failed');}
  if(psDirectory&&fs.existsSync(psDirectory+'/private-viewing-fixtures.json')){
   const j=JSON.parse(fs.readFileSync(psDirectory+'/private-viewing-fixtures.json','utf8').replace(/^\uFEFF/,''));if(!fixtures.some(f=>f.id===j.actor))throw Error('PowerShell actor guard');helperFixtures=j.fixtures;helperEvents=j.events;
   const pattern=/^bedos-viewing-[0-9a-f]{32}-(gallery|draft)$/;if(helperFixtures.some(f=>!f.id||!['customer','property','viewing'].includes(f.kind)||!(/^[0-9a-f-]{36}$/).test(f.id)||(f.kind==='property'&&!pattern.test(f.slug))||(f.kind==='customer'&&(!f.email.startsWith('bedos-viewing-')||!f.email.endsWith('@bedos-production-viewing-test.invalid')))))throw Error('PowerShell fixture proof invalid');
   if(helperFixtures.some(f=>f.state!=='deleted'))throw Error('PowerShell exact fixtures need controlled review');
   const helperViewings=helperFixtures.filter(f=>f.kind==='viewing').map(f=>quote(f.id));if(helperViewings.length)sql(`DELETE FROM public.viewing_notification_events WHERE viewing_id IN (${helperViewings});`);
   const auditIds=[...helperFixtures,...helperEvents].map(f=>quote(f.id));if(auditIds.length)sql(`DELETE FROM public.audit_logs WHERE entity_id IN (${auditIds});`);
  }
  const ids=fixtures.map(f=>quote(f.id)).join(',');
  if(properties.length&&Number(sql(`SELECT count(*) FROM public.properties WHERE id IN (${properties.map(quote)}) AND (slug<>${quote(prefix)} OR created_by NOT IN (${ids||'NULL'}));`)))throw Error('Property cleanup ownership guard failed');
  if(ids){sql(`BEGIN;DELETE FROM public.notifications WHERE related_entity_type='viewing_request' AND related_entity_id IN(SELECT viewing_id FROM public.viewing_notification_events WHERE created_by IN(${ids}));DELETE FROM public.viewing_notification_events WHERE created_by IN(${ids});DELETE FROM public.viewing_requests WHERE customer_id IN(${ids}) AND property_id IN(SELECT id FROM public.properties WHERE slug=${quote(prefix)});DELETE FROM public.properties WHERE slug=${quote(prefix)} AND created_by IN(${ids});DELETE FROM public.audit_logs WHERE actor_id IN(${ids});COMMIT;`);}
  for(const f of fixtures){const r=await admin.auth.admin.deleteUser(f.id);check('exact local Auth fixture removed',!r.error);}
  check('exact local viewing fixtures absent',sql(`SELECT (SELECT count(*) FROM auth.users WHERE email LIKE ${quote(prefix+'%@bedos-viewing-live.invalid')})+(SELECT count(*) FROM public.properties WHERE slug=${quote(prefix)});`)==='0');
 }catch{results.push({name:'Local viewing fixture cleanup needs controlled review',pass:false});fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/viewing-local-cleanup.json',JSON.stringify({prefix,fixtures:fixtures.map(({id,email,name})=>({id,email,name})),properties,requests}));}
 try {
  if(installed||seeded){const current=functions();if(installed)check('installed temporary function sources match',current.length===names.length&&current.every(f=>f.body.replace(/\s+/g,'')===source.slice(source.indexOf(`CREATE FUNCTION public.${f.name}(`)).split('$function$')[1].replace(/\s+/g,'')));
   sql(`BEGIN;SET LOCAL lock_timeout='5s';DROP POLICY IF EXISTS bedos_viewing_active_read ON public.viewing_requests;DROP TRIGGER IF EXISTS viewing_requests_version ON public.viewing_requests;DROP TRIGGER IF EXISTS viewing_property_publication_guard ON public.viewing_requests;DROP TRIGGER IF EXISTS enquiry_property_publication_guard ON public.enquiries;DROP TABLE IF EXISTS public.viewing_notification_events;${current.map(f=>`DROP FUNCTION public.${f.name}(${f.identity});`).join('\n')}
   DROP INDEX IF EXISTS public.notifications_one_viewing_event_recipient;DROP INDEX IF EXISTS public.viewing_requests_customer_page_idx;DROP INDEX IF EXISTS public.viewing_requests_property_page_idx;DROP INDEX IF EXISTS public.viewing_requests_assignment_page_idx;DROP INDEX IF EXISTS public.viewing_requests_status_page_idx;
   ALTER TABLE public.viewing_requests DROP COLUMN IF EXISTS version;ALTER TABLE public.viewing_requests DROP CONSTRAINT viewing_requests_status_check;ALTER TABLE public.viewing_requests ADD CONSTRAINT viewing_requests_status_check ${originalViewingConstraint};
   ALTER TABLE public.properties DROP CONSTRAINT properties_status_check;ALTER TABLE public.properties ADD CONSTRAINT properties_status_check ${originalConstraint};
   REVOKE ALL ON public.properties,public.viewing_requests FROM PUBLIC,anon,authenticated,service_role;${originalGrants.map(g=>`GRANT ${g.privilege} ON public.${g.table} TO ${g.role==='PUBLIC'?'PUBLIC':'"'+g.role+'"'}${g.grantable==='YES'?' WITH GRANT OPTION':''};`).join('\n')}
   ${originalHelper.definition};DELETE FROM public.role_permissions WHERE permission_id IN(SELECT id FROM public.permissions WHERE name IN('properties.view','properties.manage','viewings.view','viewings.manage','users.view'));${originalMappings.map(m=>`INSERT INTO public.role_permissions(role_id,permission_id) VALUES(${quote(m.role_id)},${quote(m.permission_id)});`).join('\n')}
   DELETE FROM public.permissions WHERE name IN('properties.view','properties.manage','viewings.view','viewings.manage','users.view') ${originalPermissions.length?`AND id NOT IN(${originalPermissions.map(p=>quote(p.id))})`:''};COMMIT;NOTIFY pgrst,'reload schema';`);
   check('original grants restored',JSON.stringify(json(grantsQuery))===JSON.stringify(originalGrants));check('original role helper restored',JSON.stringify(json(helperQuery))===JSON.stringify(originalHelper));check('original mappings restored',JSON.stringify(json(mappingsQuery))===JSON.stringify(originalMappings)&&JSON.stringify(json(permissionsQuery))===JSON.stringify(originalPermissions));check('temporary functions removed',functions().length===0);check('viewing notification catalog and aggregates restored exactly',JSON.stringify(catalog())===JSON.stringify(originalCatalog));
  }
 }catch{results.push({name:'Local viewing dependency restoration needs controlled review',pass:false});}
 fs.mkdirSync('docs/module-6-evidence',{recursive:true});const report={date:new Date().toISOString(),production_helper_local_assertions:helperChecks,scope:'Real guarded loopback Next/Auth/PostgREST, concurrent state/account changes and notification failure recovery; no hosted credentials or production requests',results};fs.writeFileSync('docs/module-6-evidence/local-viewing-integration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:results.length,failed:results.filter(x=>!x.pass).length,results}));if(results.some(x=>!x.pass))process.exitCode=1;
}
