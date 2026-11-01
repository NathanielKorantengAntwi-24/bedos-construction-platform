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
const run=crypto.randomUUID(),prefix=`catalog-live-${run}`,fixtures=[],enquiries=[],results=[];
let stage='preflight',installed=false,seeded=false,controlCreated=false,server,serverLog,providerStaff,psDirectory,helperChecks=0;
const check=(name,pass)=>{stage=name;results.push({name,pass:!!pass});if(!pass)throw Error('Local catalog check failed');};
const source=fs.readFileSync('supabase/migrations/20261101040000_secure_service_catalog.sql','utf8')+'\n'+fs.readFileSync('supabase/migrations/20261101050000_restrict_service_catalog_writes.sql','utf8');
const names=[...source.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)].map(x=>x[1]);
const functions=()=>json(`SELECT coalesce(json_agg(json_build_object('name',p.proname,'body',p.prosrc,'identity',pg_get_function_identity_arguments(p.oid)) ORDER BY p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${names.map(quote)});`);
const helperQuery="SELECT json_build_object('definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl::text) FROM pg_proc WHERE oid='public.get_user_role()'::regprocedure;";
const originalHelper=json(helperQuery);
const grantsQuery="SELECT coalesce(json_agg(json_build_object('table',table_name,'role',grantee,'privilege',privilege_type,'grantable',is_grantable) ORDER BY table_name,grantee,privilege_type),'[]') FROM information_schema.table_privileges WHERE table_schema='public' AND table_name IN ('services','service_categories') AND grantee IN ('PUBLIC','anon','authenticated','service_role');";
const originalGrants=json(grantsQuery);
const permissionsQuery="SELECT coalesce(json_agg(json_build_object('id',id,'name',name) ORDER BY name),'[]') FROM public.permissions WHERE name IN ('services.view','services.manage');";
const originalPermissions=json(permissionsQuery);
const mappingsQuery="SELECT coalesce(json_agg(json_build_object('role_id',rp.role_id,'permission_id',rp.permission_id) ORDER BY rp.role_id,rp.permission_id),'[]') FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id WHERE p.name IN ('services.view','services.manage');";
const originalMappings=json(mappingsQuery);
const jar=()=>new Map();
async function api(path,method='GET',body,session){
 if(!path.startsWith('/api/'))throw Error('Local API path guard failed');
 const response=await fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(45000),headers:{Connection:'close',...(body!==undefined?{'Content-Type':'application/json'}:{}),...(session?.size?{Cookie:[...session].map(([k,v])=>`${k}=${v}`).join('; ')}:{})},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
 if(session)for(const raw of response.headers.getSetCookie()){const pair=raw.split(';')[0],at=pair.indexOf('=');if(/max-age=0/i.test(raw))session.delete(pair.slice(0,at));else session.set(pair.slice(0,at),pair.slice(at+1));}
 let data;try{data=await response.json();}catch{data=null;}
 return {status:response.status,data,cache:response.headers.get('cache-control')};
}
async function fixture(label,role){
 const email=`${prefix}-${label}@bedos-catalog-live.invalid`,name=`Local catalog ${run} ${label}`,password=crypto.randomBytes(24).toString('base64url')+'aA1!';
 const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name}});
 const f={id:r.data.user?.id,email,name,password,role,jar:jar()};if(f.id)fixtures.push(f);
 check(`${label} exact local Auth fixture`,!r.error&&!!f.id&&r.data.user.email===email);
 sql(`UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name=${quote(role)}),account_status='active' WHERE id=${quote(f.id)};`);
 const login=await api('/api/auth/login','POST',{email,password},f.jar);check(`${label} actual backend login`,login.status===200&&login.data.user.id===f.id);
 return f;
}
async function category(actor,label){const r=await api('/api/service-categories','POST',{name:`${prefix} ${label}`,slug:`${prefix}-${label}`},actor.jar);check(`create category ${label}`,r.status===201);return r.data.category;}
async function service(actor,label,extra={}){const r=await api('/api/services','POST',{name:`${prefix} ${label}`,slug:`${prefix}-${label}`,...extra},actor.jar);check(`create service ${label}`,r.status===201);return r.data.service;}
async function audits(id){const r=await admin.from('audit_logs').select('actor_id,action,metadata').eq('entity_id',id);check('audit read succeeds',!r.error);return r.data;}
try{
 check('temporary catalog functions absent before test',functions().length===0);
 check('local audit failure control absent',sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bedos_catalog_live_audit_failure';")==='0');
 check('expected local role fixtures available',sql("SELECT count(*) FROM public.roles WHERE name IN ('administrator','content_manager','customer','finance');")==='4');
 await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(55330,'127.0.0.1',()=>probe.close(resolve));});
 // Seed only missing local permission rows/mappings; record and restore their exact prior state.
 sql(`BEGIN; INSERT INTO public.permissions(name) VALUES('services.view'),('services.manage') ON CONFLICT(name) DO NOTHING;
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.name IN ('administrator','content_manager') AND p.name IN ('services.view','services.manage') ON CONFLICT DO NOTHING;
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.name='customer' AND p.name='services.view' ON CONFLICT DO NOTHING;
 ${fs.readFileSync('supabase/migrations/20261029000000_restrict_role_lookup_to_active_accounts.sql','utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'')}
 COMMIT;`);seeded=true;
 sql(source+"\nNOTIFY pgrst,'reload schema';");installed=true;
 fs.mkdirSync('node_modules/.cache',{recursive:true});serverLog=fs.openSync(`node_modules/.cache/catalog-live-${run}.log`,'w');
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','55330'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:base,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:anonKey,SUPABASE_SERVICE_ROLE_KEY:serviceKey,BEDOS_APP_ORIGIN:origin,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore',serverLog,serverLog]});
 const deadline=Date.now()+90000;let ready=false;
 while(Date.now()<deadline){if(server.exitCode!==null)throw Error('Local Next server exited');try{const r=await api('/api/public/services');if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,400));}
 check('actual local Next server ready with local Supabase only',ready);
 const owner=await fixture('administrator','administrator'),staff=await fixture('content','content_manager'),customer=await fixture('customer','customer'),finance=await fixture('finance','finance');
 let r=await api('/api/services');check('anonymous staff API denied',r.status===401);
 r=await api('/api/services','POST',{name:'x',slug:'x'},customer.jar);check('customer management denied',r.status===403);
 r=await api('/api/services','GET',undefined,finance.jar);check('unprivileged finance read denied',r.status===403);
 r=await api('/api/services','POST','{',staff.jar);check('malformed JSON rejected by actual route',r.status===400);
 r=await api('/api/services','POST',{name:'n',slug:'s',featured:'false'},staff.jar);check('wrong boolean rejected by actual route',r.status===400);
 const cat=await category(owner,'visible-category'),hidden=await category(staff,'hidden-category');
 const draft=await service(staff,'draft',{category_id:cat.id}),published=await service(owner,'published',{category_id:cat.id,status:'published',featured:true}),archived=await service(staff,'archived',{category_id:hidden.id,status:'archived'});
 r=await api(`/api/services?q=${prefix}`, 'GET',undefined,staff.jar);check('content staff list includes three states',r.status===200&&r.data.pagination.total===3);
 r=await api(`/api/services?q=${prefix}`,'GET',undefined,customer.jar);check('customer with services.view still sees only published content',r.status===200&&r.data.pagination.total===1&&r.data.services[0].id===published.id);
 r=await api(`/api/services/${draft.id}`,'GET',undefined,customer.jar);check('customer cannot guess protected draft UUID',r.status===404);
 r=await api(`/api/services/${archived.id}`,'GET',undefined,customer.jar);check('customer cannot guess archived UUID',r.status===404);
 r=await api(`/api/service-categories?q=${prefix}`,'GET',undefined,customer.jar);check('customer original category access retained',r.status===200&&r.data.pagination.total===2);
 r=await api(`/api/public/services?q=${prefix}`);check('public HTTP only published',r.status===200&&r.data.pagination.total===1&&r.data.services[0].id===published.id);
 check('public HTTP safe exact fields',JSON.stringify(Object.keys(r.data.services[0]).sort())===JSON.stringify(['category_id','description','featured','id','name','slug']));
 check('public reads are not cacheable',r.cache==='no-store');
 r=await api(`/api/public/service-categories?q=${prefix}`);check('public category HTTP hides unpublished-only category',r.status===200&&r.data.pagination.total===1&&r.data.categories[0].id===cat.id);
 for(const record of [draft,archived]){r=await api(`/api/public/services/${record.slug}`);check(`${record.status} public slug hidden`,r.status===404);}
 r=await api(`/api/public/services/${published.slug}`);check('published public detail available',r.status===200&&r.data.service.id===published.id&&!('created_by' in r.data.service));
 r=await api(`/api/public/services?status=draft`);check('public status override rejected',r.status===400);
 r=await api(`/api/services?q=${prefix}&page=2&page_size=3`,'GET',undefined,owner.jar);check('empty HTTP page retains exact count',r.status===200&&r.data.services.length===0&&r.data.pagination.total===3);
 r=await api('/api/service-categories','POST',{name:`${prefix} visible-category`,slug:`${prefix}-duplicate`},owner.jar);check('category duplicate is safe conflict',r.status===409&&!JSON.stringify(r.data).includes('service_categories_name_key'));
 providerStaff=createClient(base,anonKey,options);let signed=await providerStaff.auth.signInWithPassword({email:staff.email,password:staff.password});check('actual provider staff RLS session',!signed.error);
 r=await providerStaff.from('services').select('id').eq('id',draft.id);check('active content RLS sees draft',!r.error&&r.data.length===1);
 r=await anonymous.from('services').select('id').eq('id',published.id);check('anonymous direct table remains private',!r.error&&r.data.length===0);
 for(const [label,client] of [['anonymous',anonymous],['authenticated content',providerStaff],['service',admin]]){
  r=await client.from('services').update({featured:true}).eq('id',draft.id);check(`${label} direct service write denied`,r.error?.code==='42501');
  r=await client.from('service_categories').insert({name:`${prefix}-bypass`,slug:`${prefix}-bypass`});check(`${label} direct category insert denied`,r.error?.code==='42501');
 }
 r=await providerStaff.rpc('bedos_mutate_service',{p_actor_id:owner.id,p_action:'delete',p_id:draft.id,p_input:{}});check('authenticated client cannot forge actor RPC',r.error?.code==='42501');
 // Same existing backend/provider sessions must immediately reflect role/status changes.
 const cookiesBefore=JSON.stringify([...staff.jar]);
 sql(`UPDATE public.profiles SET account_status='suspended' WHERE id=${quote(staff.id)};`);
 r=await api(`/api/services/${draft.id}`,'GET',undefined,staff.jar);check('same backend session blocked while suspended',r.status===403);
 r=await providerStaff.from('services').select('id').eq('id',draft.id);check('same provider session loses draft RLS while suspended',!r.error&&r.data.length===0);
 sql(`UPDATE public.profiles SET account_status='active',role_id=(SELECT id FROM public.roles WHERE name='finance') WHERE id=${quote(staff.id)};`);
 r=await api(`/api/services/${draft.id}`,'GET',undefined,staff.jar);check('same session loses role permission',r.status===403);
 sql(`UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name='content_manager') WHERE id=${quote(staff.id)};`);
 r=await api(`/api/services/${draft.id}`,'GET',undefined,staff.jar);check('same session regains content permission',r.status===200);
 check('no backend reauthentication required for role/status checks',JSON.stringify([...staff.jar])===cookiesBefore);
 // Each concurrent partial edit must preserve the other edit and have one audit.
 let before=await audits(draft.id);
 const race=await Promise.all([api(`/api/services/${draft.id}`,'PATCH',{description:'Race description'},owner.jar),api(`/api/services/${draft.id}`,'PATCH',{featured:true},staff.jar)]);
 check('concurrent partial updates both commit',race.every(x=>x.status===200));
 r=await api(`/api/services/${draft.id}`,'GET',undefined,staff.jar);check('concurrent partial updates do not lose fields',r.data.service.description==='Race description'&&r.data.service.featured===true);
 let after=await audits(draft.id);check('concurrent partial updates each audited once',after.length===before.length+2);
 // Inject an audit failure only for this exact fixture; both operations must roll back.
 sql(`BEGIN;CREATE FUNCTION public.bedos_catalog_live_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id=${quote(draft.id)}::uuid AND (NEW.action='service_deleted' OR (NEW.action='service_updated' AND NEW.metadata->'after'->>'name'=${quote('Audit failure '+run)})) THEN RAISE EXCEPTION 'Local synthetic catalog audit failure' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;
 CREATE TRIGGER bedos_catalog_live_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.bedos_catalog_live_audit_failure();COMMIT;`);controlCreated=true;
 before=await audits(draft.id);
 r=await api(`/api/services/${draft.id}`,'PATCH',{name:'Audit failure '+run},owner.jar);check('actual HTTP audit failure is sanitized 500',r.status===500&&!JSON.stringify(r.data).includes('synthetic'));
 r=await api(`/api/services/${draft.id}`,'DELETE',undefined,owner.jar);check('actual HTTP delete audit failure is safe 500',r.status===500);
 after=await audits(draft.id);check('failed HTTP writes add no audit',before.length===after.length);
 r=await api(`/api/services/${draft.id}`,'GET',undefined,owner.jar);check('failed HTTP writes preserve record',r.status===200&&r.data.service.name===draft.name);
 sql('BEGIN;DROP TRIGGER bedos_catalog_live_audit ON public.audit_logs;DROP FUNCTION public.bedos_catalog_live_audit_failure();COMMIT;');controlCreated=false;
 // Category deletion racing creation has only valid serial outcomes.
 const racingCat=await category(owner,'race-create-category');
 const created=await Promise.all([api('/api/services','POST',{name:`${prefix} race-created`,slug:`${prefix}-race-created`,category_id:racingCat.id},staff.jar),api(`/api/service-categories/${racingCat.id}`,'DELETE',undefined,owner.jar)]);
 check('category deletion versus service creation serializes',created[1].status===200&&[201,400].includes(created[0].status));
 if(created[0].status===201){r=await api(`/api/services/${created[0].data.service.id}`,'GET',undefined,owner.jar);check('concurrent created service retained detached',r.status===200&&r.data.service.category_id===null);}
 const moveCat=await category(owner,'race-move-category');
 const moved=await Promise.all([api(`/api/services/${draft.id}`,'PATCH',{category_id:moveCat.id},staff.jar),api(`/api/service-categories/${moveCat.id}`,'DELETE',undefined,owner.jar)]);
 check('category deletion versus reassignment serializes',moved[1].status===200&&[200,400].includes(moved[0].status));
 r=await api(`/api/services/${draft.id}`,'GET',undefined,owner.jar);check('reassignment never leaves dangling category',r.status===200&&(moved[0].status===200?r.data.service.category_id===null:r.data.service.category_id===cat.id));
 // Preserve enquiry references: existing rows survive service deletion with a null link.
 const enquiryId=crypto.randomUUID();enquiries.push(enquiryId);
 r=await admin.from('enquiries').insert({id:enquiryId,enquiry_type:'quote_request',service_id:published.id});check('local enquiry reference fixture created',!r.error);
 r=await api(`/api/services/${published.id}`,'DELETE',undefined,owner.jar);check('delete published service through HTTP',r.status===200);
 r=await admin.from('enquiries').select('id,service_id').eq('id',enquiryId).single();check('HTTP deletion preserves and detaches enquiry',!r.error&&r.data.service_id===null);
 after=await audits(enquiryId);check('HTTP enquiry detachment audited with actor',after.length===1&&after[0].action==='enquiry_service_detached'&&after[0].actor_id===owner.id);
 r=await api(`/api/public/services/${published.slug}`);check('deleted service immediately unavailable publicly',r.status===404);
 r=await api(`/api/service-categories/${cat.id}`,'DELETE',undefined,owner.jar);check('delete category through HTTP',r.status===200);
 r=await api(`/api/services/${draft.id}`,'GET',undefined,owner.jar);check('category deletion retains draft with null category',r.status===200&&r.data.service.category_id===null);
 // Exercise the actual private production workflow under Windows PowerShell 5.
 // Only destinations, output paths and interactive prompts change in this ignored local copy.
 stage='local PowerShell workflow';
 psDirectory=`${process.cwd().replaceAll('\\','/')}/.next/catalog-ps-${run}`;fs.mkdirSync(psDirectory,{recursive:true});
 const psQuote=s=>"'"+s.replaceAll("'","''")+"'";
 let ps=fs.readFileSync('scripts/Test-ProductionServiceCatalog.ps1','utf8');
 ps=ps.replace("$root=Split-Path $PSScriptRoot -Parent",`$root=${psQuote(process.cwd())}`)
  .replace("$directory=Join-Path $root 'docs/module-3-evidence'",`$directory=${psQuote(psDirectory)}`)
  .replace(". (Join-Path $PSScriptRoot 'lib/ProductionVerification.ps1')",`. ${psQuote(process.cwd()+'/scripts/lib/ProductionVerification.ps1')}`)
  .replaceAll('https://bedos-construction-platform.vercel.app',origin).replaceAll('https://zjdqomckldeipigqqfqm.supabase.co',base);
 if(ps.includes('https://bedos-construction-platform.vercel.app')||ps.includes('https://zjdqomckldeipigqqfqm.supabase.co'))throw Error('Local PowerShell destination guard failed');
 ps=`function Read-Host { param([string]$Prompt,[switch]$AsSecureString) if($AsSecureString){$value=New-Object System.Security.SecureString;foreach($character in $env:BEDOS_CATALOG_LOCAL_PASSWORD.ToCharArray()){$value.AppendChar($character)};$value.MakeReadOnly();return $value};return $env:BEDOS_CATALOG_LOCAL_EMAIL }\n`+ps;
 fs.writeFileSync(psDirectory+'/verify.ps1',ps);
 const psEnv={...process.env,BEDOS_CATALOG_LOCAL_EMAIL:owner.email,BEDOS_CATALOG_LOCAL_PASSWORD:owner.password};
 // Let Windows PowerShell 5 resolve its own standard modules, rather than inherit
 // PowerShell 7's module search paths through this Node process.
 for(const key of Object.keys(psEnv))if(key.toLowerCase()==='psmodulepath')delete psEnv[key];
 const psOutput=execFileSync('powershell.exe',['-NoProfile','-File',psDirectory+'/verify.ps1'],{env:psEnv,encoding:'utf8',windowsHide:true,timeout:90000,stdio:['ignore','pipe','pipe']});
 fs.writeFileSync(psDirectory+'/console.txt',psOutput);
 const psReport=JSON.parse(fs.readFileSync(psDirectory+'/production-catalog-admin.json','utf8').replace(/^\uFEFF/,''));
 const psJournal=JSON.parse(fs.readFileSync(psDirectory+'/private-catalog-fixtures.json','utf8').replace(/^\uFEFF/,''));
 helperChecks=psReport.results.length;
 check('production PowerShell workflow passes against guarded local origin',helperChecks>30&&psReport.results.every(x=>x.pass));
 check('PowerShell workflow removes all five exact content fixtures',psJournal.state==='complete'&&psJournal.fixtures.length===5&&psJournal.fixtures.every(x=>x.state==='deleted'));
 check('PowerShell workflow signs administrator out',psReport.results.some(x=>x.name==='Administrator logout'&&x.http_status===200));
 for(const f of fixtures){r=await api('/api/auth/logout','POST',{},f.jar);check(`${f.role} backend logout`,r.status===200);}
}catch(error){results.push({name:'Local catalog integration stopped',pass:false,stage,error_type:error.name,...(typeof error.cause?.code==='string'?{cause_code:error.cause.code}:{})});}
finally{
 if(server){server.kill();await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,5000);});}if(serverLog!==undefined)fs.closeSync(serverLog);
 try{
  if(providerStaff)await providerStaff.auth.signOut({scope:'local'});
  for(const f of fixtures){const r=await admin.auth.admin.getUserById(f.id);if(r.error||r.data.user?.email!==f.email||r.data.user.user_metadata?.full_name!==f.name)throw Error('Exact local fixture cleanup guard failed');}
  const ids=fixtures.map(f=>quote(f.id)).join(',');
  // If a workflow check failed, rescue only its exact local nonce-bound fixtures.
  if(psDirectory&&fs.existsSync(psDirectory+'/private-catalog-fixtures.json')){
   const journal=JSON.parse(fs.readFileSync(psDirectory+'/private-catalog-fixtures.json','utf8').replace(/^\uFEFF/,''));
   if(journal.fixtures.length&&!fixtures.some(f=>f.id===journal.actor))throw Error('Local PowerShell actor cleanup guard failed');
   for(const kind of ['services','service-categories'])for(const f of journal.fixtures.filter(x=>x.kind===kind)){
    if(!/^bedos-catalog-[a-f0-9]{32}-/.test(f.slug)||!f.name.startsWith('Temporary verification '))throw Error('Local PowerShell fixture guard failed');
    const table=kind==='services'?'services':'service_categories';
    const rows=json(`SELECT coalesce(json_agg(t),'[]') FROM (SELECT id,name,slug${kind==='services'?',created_by':''} FROM public.${table} WHERE slug=${quote(f.slug)}) t;`);
    if(rows.some(x=>x.name!==f.name||(f.id&&x.id!==f.id)||(kind==='services'&&x.created_by!==journal.actor)))throw Error('Local PowerShell exact identity guard failed');
    if(rows.length)sql(`DELETE FROM public.${table} WHERE id=${quote(rows[0].id)} AND slug=${quote(f.slug)};`);
   }
  }
  const dangerous=Number(sql(`SELECT count(*) FROM public.services WHERE slug LIKE ${quote(prefix+'%')} AND (created_by IS NULL OR created_by NOT IN (${ids||'NULL'}));`));
  if(dangerous)throw Error('Local service cleanup ownership guard failed');
  sql(`BEGIN;${controlCreated?'DROP TRIGGER IF EXISTS bedos_catalog_live_audit ON public.audit_logs;DROP FUNCTION IF EXISTS public.bedos_catalog_live_audit_failure();':''}
   ${enquiries.length?`DELETE FROM public.enquiries WHERE id IN (${enquiries.map(quote)});`:''}
   DELETE FROM public.services WHERE slug LIKE ${quote(prefix+'%')};DELETE FROM public.service_categories WHERE slug LIKE ${quote(prefix+'%')};
   ${ids?`DELETE FROM public.audit_logs WHERE actor_id IN (${ids});`:''}COMMIT;`);
  for(const f of fixtures){const r=await admin.auth.admin.deleteUser(f.id);check('exact local catalog Auth fixture removed',!r.error);}
  check('no local catalog test accounts remain',sql(`SELECT count(*) FROM auth.users WHERE email LIKE ${quote(prefix+'%@bedos-catalog-live.invalid')};`)==='0');
  check('no local catalog content remains',sql(`SELECT (SELECT count(*) FROM public.services WHERE slug LIKE ${quote(prefix+'%')})+(SELECT count(*) FROM public.service_categories WHERE slug LIKE ${quote(prefix+'%')});`)==='0');
 }catch{results.push({name:'Local catalog fixture cleanup needs review',pass:false});fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/catalog-local-cleanup.json',JSON.stringify({fixtures:fixtures.map(({id,email,name})=>({id,email,name})),prefix,enquiries}));}
 try{
  if(installed||seeded){
   const current=functions();if(installed)check('temporary function bodies unchanged before cleanup',current.length===names.length&&current.every(f=>{
    const marker=`CREATE FUNCTION public.${f.name}(`,part=source.slice(source.indexOf(marker));return f.body.replace(/\s+/g,'')===part.split('$function$')[1].replace(/\s+/g,'');
   }));
   const drop=current.map(f=>`DROP FUNCTION public.${f.name}(${f.identity});`).join('\n');
   // PL/pgSQL call dependencies are resolved at execution, so all six can be dropped safely.
   sql(`BEGIN;SET LOCAL lock_timeout='5s';${drop}
     REVOKE ALL ON public.services,public.service_categories FROM PUBLIC,anon,authenticated,service_role;
     ${originalGrants.map(g=>`GRANT ${g.privilege} ON public.${g.table} TO ${g.role==='PUBLIC'?'PUBLIC':'"'+g.role+'"'}${g.grantable==='YES'?' WITH GRANT OPTION':''};`).join('\n')}
     ${originalHelper.definition};
     DELETE FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE name IN ('services.view','services.manage'));
     ${originalMappings.map(m=>`INSERT INTO public.role_permissions(role_id,permission_id) VALUES(${quote(m.role_id)},${quote(m.permission_id)});`).join('\n')}
     DELETE FROM public.permissions WHERE name IN ('services.view','services.manage') ${originalPermissions.length?`AND id NOT IN (${originalPermissions.map(p=>quote(p.id))})`:''};
     COMMIT;NOTIFY pgrst,'reload schema';`);
   check('original table grants restored',JSON.stringify(json(grantsQuery))===JSON.stringify(originalGrants));
   check('original role helper restored',JSON.stringify(json(helperQuery))===JSON.stringify(originalHelper));
   check('original local permissions restored',JSON.stringify(json(permissionsQuery))===JSON.stringify(originalPermissions)&&JSON.stringify(json(mappingsQuery))===JSON.stringify(originalMappings));
   check('temporary catalog functions removed',functions().length===0);
  }
 }catch{results.push({name:'Local catalog dependency restoration needs review',pass:false});}
 fs.mkdirSync('docs/module-3-evidence',{recursive:true});const report={date:new Date().toISOString(),scope:'Local Next HTTP/Auth/PostgREST/RLS and concurrent requests only; no hosted credentials or calls; fixture confirmation is setup, not email evidence; production PowerShell workflow uses an ignored local-destination copy; exact fixture cleanup and original dependency restoration verified separately',production_helper_local_assertions:helperChecks,results};
 fs.writeFileSync('docs/module-3-evidence/local-catalog-integration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(results.some(x=>!x.pass))process.exitCode=1;
}
