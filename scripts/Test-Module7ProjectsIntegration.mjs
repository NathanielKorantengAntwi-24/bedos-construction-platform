// Real local Next/Auth/PostgREST/Storage. No hosted credentials or production requests.
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import {execFileSync,spawn} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import sharp from 'sharp';
const container='supabase_db_bedos-supabase-lab',authContainer='supabase_auth_bedos-supabase-lab';
const inspect=n=>JSON.parse(execFileSync('docker',['inspect',n],{encoding:'utf8',windowsHide:true}))[0];
const db=inspect(container),auth=inspect(authContainer),env=new Map(auth.Config.Env.map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
if(db.Name!==`/${container}`||!db.Config.Image.includes('supabase/postgres')||!db.State.Running||!env.get('GOTRUE_DB_DATABASE_URL')?.includes(container)||!env.get('GOTRUE_JWT_SECRET'))throw Error('Local lab guard failed');
const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
const quote=s=>`'${s.replaceAll("'","''")}'`,json=q=>JSON.parse(sql(q));
const origin='http://127.0.0.1:55330',base='http://127.0.0.1:55321';
function jwt(role){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `${h}.${p}.`+crypto.createHmac('sha256',env.get('GOTRUE_JWT_SECRET')).update(`${h}.${p}`).digest('base64url');}
const anonKey=jwt('anon'),serviceKey=jwt('service_role'),options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},admin=createClient(base,serviceKey,options);
const run=crypto.randomUUID(),prefix='project-local-'+run,fixtures=[],projects=[],results=[];
let server,log,installed=false,seeded=false,stage='preflight';
const check=(name,pass)=>{stage=name;results.push({name,pass:!!pass});if(!pass)throw Error('Local project verification failed');};
const source=['20261101040000_secure_service_catalog.sql','20261102030000_secure_construction_projects.sql','20261102040000_restrict_construction_project_access.sql'].map(n=>fs.readFileSync('supabase/migrations/'+n,'utf8')).join('\n');
const names=[...source.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)].map(m=>m[1]);
const funcs=()=>json(`SELECT coalesce(json_agg(json_build_object('name',proname,'identity',pg_get_function_identity_arguments(oid)) ORDER BY proname),'[]') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(${names.map(quote)});`);
const catalog=()=>sql(fs.readFileSync('scripts/MODULE_7_READONLY_REVIEW.sql','utf8'));
const originalCatalog=catalog();
const grantsQuery="SELECT coalesce(json_agg(json_build_object('table',table_name,'role',grantee,'privilege',privilege_type,'grantable',is_grantable) ORDER BY table_name,grantee,privilege_type),'[]') FROM information_schema.table_privileges WHERE table_schema='public' AND table_name IN ('projects','project_stages','project_images') AND grantee IN ('PUBLIC','anon','authenticated','service_role');";
const grants=json(grantsQuery),helper=sql("SELECT pg_get_functiondef('public.get_user_role()'::regprocedure);");
const permissions=json("SELECT coalesce(json_agg(id),'[]') FROM public.permissions WHERE name IN('projects.view','projects.manage','services.manage');");
const mappingsQuery="SELECT coalesce(json_agg(json_build_object('role',rp.role_id,'permission',rp.permission_id) ORDER BY rp.role_id,rp.permission_id),'[]') FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id WHERE p.name IN('projects.view','projects.manage','services.manage');";
const mappings=json(mappingsQuery),bucket=json("SELECT coalesce(json_agg(to_jsonb(b)),'[]') FROM storage.buckets b WHERE id='project-images';");
const api=async(path,method='GET',body,session,extra={})=>{
 if(!path.startsWith('/api/'))throw Error('Local path guard');const multipart=body instanceof FormData;
 const r=await fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(45000),headers:{Connection:'close',...(body!==undefined&&!multipart?{'Content-Type':'application/json'}:{}),...(session?.size?{Cookie:[...session].map(([k,v])=>k+'='+v).join('; ')}:{}),...extra},...(body!==undefined?{body:multipart?body:JSON.stringify(body)}:{})});
 if(session)for(const raw of r.headers.getSetCookie()){const pair=raw.split(';')[0],i=pair.indexOf('=');if(/max-age=0/i.test(raw))session.delete(pair.slice(0,i));else session.set(pair.slice(0,i),pair.slice(i+1));}
 const type=r.headers.get('content-type')??'';let data,bytes;if(type.startsWith('image/'))bytes=Buffer.from(await r.arrayBuffer());else try{data=await r.json();}catch{}
 return {status:r.status,data,bytes,cache:r.headers.get('cache-control'),nosniff:r.headers.get('x-content-type-options')};
};
async function fixture(role){const email=`${prefix}-${role}@module7.invalid`,name=`Module 7 ${run} ${role}`,password=crypto.randomBytes(24).toString('base64url')+'aA1!';const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name}});const f={id:r.data.user?.id,email,name,password,jar:new Map(),role};if(f.id)fixtures.push(f);check(role+' fixture created',!r.error&&!!f.id);sql(`UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name=${quote(role)}),account_status='active' WHERE id=${quote(f.id)};`);const login=await api('/api/auth/login','POST',{email,password},f.jar);check(role+' real password login',login.status===200);f.direct=createClient(base,anonKey,options);check(role+' direct Auth session',!(await f.direct.auth.signInWithPassword({email,password})).error);return f;}
let category,service;
try{
 check('temporary functions absent',funcs().length===0);check('local project baseline empty',sql('SELECT (SELECT count(*) FROM public.projects)+(SELECT count(*) FROM public.project_images)+(SELECT count(*) FROM public.project_stages);')==='0');
 fs.mkdirSync('node_modules/.cache/module7',{recursive:true});fs.writeFileSync(`node_modules/.cache/module7/${run}-baseline.json`,JSON.stringify({run,prefix,originalCatalog,grants,helper,permissions,mappings,bucket},null,2));
 await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(55330,'127.0.0.1',()=>s.close(resolve));});
 seeded=true;sql(`BEGIN;INSERT INTO storage.buckets(id,name,public) VALUES('project-images','project-images',false) ON CONFLICT DO NOTHING;
 INSERT INTO public.permissions(name) VALUES('projects.view'),('projects.manage'),('services.manage') ON CONFLICT(name) DO NOTHING;
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE(r.name IN('administrator','content_manager') AND p.name IN('projects.view','projects.manage')) OR(r.name='administrator' AND p.name='services.manage') OR(r.name='customer' AND p.name='projects.view') ON CONFLICT DO NOTHING;
 CREATE POLICY m7_local_original_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='project-images');
 CREATE POLICY m7_local_original_write ON storage.objects FOR ALL TO authenticated USING(bucket_id='project-images' AND public.get_user_role() IN('administrator','content_manager')) WITH CHECK(bucket_id='project-images' AND public.get_user_role() IN('administrator','content_manager'));COMMIT;`);
 installed=true;sql(source);sql("NOTIFY pgrst,'reload schema';");
 fs.mkdirSync('node_modules/.cache',{recursive:true});log=fs.openSync(`node_modules/.cache/project-${run}.log`,'w');
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','55330'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:base,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:anonKey,SUPABASE_SERVICE_ROLE_KEY:serviceKey,BEDOS_APP_ORIGIN:origin,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore',log,log]});
 let ready=false;for(const deadline=Date.now()+90000;Date.now()<deadline;){if(server.exitCode!==null)throw Error('Next server exited');try{if((await api('/api/projects')).status===401){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,400));}check('real project routes ready',ready);
 const owner=await fixture('administrator'),content=await fixture('content_manager'),customer=await fixture('customer'),finance=await fixture('finance');
 for(const f of [customer,finance])check(f.role+' management read denied',(await api('/api/projects','GET',undefined,f.jar)).status===403);
 let r=await api('/api/project-categories','POST',{name:'Local category',slug:prefix},owner.jar);check('category created',r.status===201);category=r.data.category.id;
 r=await api('/api/projects','POST',{title:'Local construction '+run,slug:prefix,category_id:category,client_name:'Private client'},content.jar);check('content creates draft',r.status===201&&r.data.project.version===1&&r.data.project.progress===null);const p=r.data.project.id;projects.push(p);const item='/api/projects/'+p;
 r=await api('/api/projects','POST',{title:'Other project',slug:prefix+'-other'},owner.jar);check('cross-parent draft created',r.status===201);const other=r.data.project.id;projects.push(other);
 check('anonymous draft hidden',(await api('/api/public/projects/'+prefix)).status===404);
 check('draft category hidden',(await api('/api/public/project-categories')).data.categories.length===0);
 check('direct customer project read denied',!!(await customer.direct.from('projects').select('*')).error);
 check('direct content project write denied',!!(await content.direct.from('projects').insert({title:'Bypass',slug:'bypass'})).error);
 check('direct service write denied',!!(await admin.from('projects').update({status:'ongoing'}).eq('id',p)).error);
 check('direct RPC actor spoof denied',!!(await customer.direct.rpc('bedos_project_read',{p_actor:owner.id})).error);
 for(const query of ['page_size=101','page=1&page=2','status=draft','q=','unexpected=true'])check('invalid public query '+query,(await api('/api/public/projects?'+query)).status===400);
 check('expected version required',(await api(item,'PATCH',{title:'Changed'},owner.jar)).status===400);
 check('protected status field rejected',(await api(item,'PATCH',{expected_version:1,status:'ongoing'},owner.jar)).status===400);
 const concurrent=await Promise.all(['One','Two'].map(title=>api(item,'PATCH',{expected_version:1,title},owner.jar)));check('concurrent edit exactly one commit',concurrent.map(x=>x.status).sort().join(',')==='200,409');
 let v=2;
 r=await api(item+'/stages','POST',{expected_version:v,name:'Foundation',stage_order:0},content.jar);check('pending stage created',r.status===201&&r.data.project.version===++v);const sid=r.data.project.stages[0].id;
 check('cross-parent stage update denied',(await api('/api/projects/'+other+'/stages/'+sid,'PATCH',{expected_version:1,name:'Wrong'},owner.jar)).status===404);
 check('completion requires start date',(await api(item+'/stages/'+sid,'PATCH',{expected_version:v,status:'in_progress'},owner.jar)).status===400);
 r=await api(item+'/stages/'+sid,'PATCH',{expected_version:v,status:'in_progress',start_date:'2026-01-01'},owner.jar);check('stage starts',r.status===200&&r.data.project.version===++v);
 check('completion requires date',(await api(item+'/stages/'+sid,'PATCH',{expected_version:v,status:'completed'},owner.jar)).status===400);
 r=await api(item+'/stages/'+sid,'PATCH',{expected_version:v,status:'completed',completion_date:'2026-02-01'},owner.jar);check('stage completes progress 100',r.status===200&&r.data.project.progress===100&&r.data.project.version===++v);
 r=await api(item+'/status','PATCH',{expected_version:v,status:'ongoing'},owner.jar);check('ongoing project published',r.status===200&&r.data.project.version===++v);
 r=await api('/api/public/projects/'+prefix);check('exact safe public detail',r.status===200&&!('client_name'in r.data.project)&&!('version'in r.data.project)&&r.data.project.progress===100&&r.cache==='no-store');
 check('category publication follows project',(await api('/api/public/project-categories')).data.categories[0].id===category);
 r=await api('/api/public/projects?category_id='+category+'&featured=false&status=ongoing&page=2');check('empty filtered page retains count',r.status===200&&r.data.projects.length===0&&r.data.pagination.total===1);
 service=json(`WITH inserted AS(INSERT INTO public.services(name,slug,status) VALUES('Local service',${quote(prefix)},'published') RETURNING id) SELECT to_jsonb(inserted) FROM inserted;`).id;
 r=await api(item,'PATCH',{expected_version:v,service_ids:[service]},owner.jar);check('published service link',r.status===200&&r.data.project.version===++v);
 check('Module 3 service deletion safely conflicts',(await admin.rpc('bedos_mutate_service',{p_actor_id:owner.id,p_action:'delete',p_id:service,p_input:{}})).error?.code==='23503');
 // Verify actual bytes and guarded Storage route, not just SQL metadata.
 const png=await sharp({create:{width:3,height:2,channels:3,background:'red'}}).png().toBuffer();
 const form=(version,phase='before')=>{const f=new FormData();f.append('file',new Blob([png],{type:'image/png'}),'../../ignored.svg');f.append('phase',phase);f.append('expected_version',String(version));return f;};
 const key=crypto.randomUUID(),uploadVersion=v;
 r=await api(item+'/images','POST',form(v),content.jar,{'Idempotency-Key':key});check('actual image upload ready',r.status===201&&r.data.image.phase==='before'&&r.data.image.is_primary);const image=r.data.image.id,file=r.data.image.image_url;v=r.data.project_version;
 check('image paths not exposed',!('storage_path'in r.data.image)&&file.startsWith(item+'/images/'));
 r=await api(file);check('public actual file bytes protected headers',r.status===200&&r.bytes.equals(png)&&r.nosniff==='nosniff'&&r.cache.includes('no-store'));
 r=await api(item+'/images','POST',form(uploadVersion),content.jar,{'Idempotency-Key':key});check('ready replay same image no duplicate',r.status===201&&r.data.image.id===image&&r.data.project_version===v);
 check('missing image idempotency key denied',(await api(item+'/images','POST',form(v),content.jar)).status===400);
 check('direct customer storage read denied',!!(await customer.direct.storage.from('project-images').list(p)).error||!(await customer.direct.storage.from('project-images').list(p)).data.length);
 check('direct content storage upload denied',!!(await content.direct.storage.from('project-images').upload(p+'/bypass.png',png,{contentType:'image/png'})).error);
 check('cross-parent image edit denied',(await api('/api/projects/'+other+'/images/'+image,'PATCH',{expected_version:1,phase:'after'},content.jar)).status===404);
 r=await api(item+'/images/'+image,'PATCH',{expected_version:v,phase:'after',display_order:2},content.jar);check('image phase and order edit',r.status===200&&r.data.image.phase==='after');v=r.data.project_version;
 check('parent deletion blocked by files',(await api(item,'DELETE',{expected_version:v},owner.jar)).status===409);
 // Synthetic audit failure rolls back finalize while preserving an earlier upload intent.
 sql(`CREATE FUNCTION public.m7_local_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='project_image_finalize' AND NEW.entity_id=${quote(p)}::uuid THEN RAISE EXCEPTION 'Synthetic finalize failure' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;CREATE TRIGGER m7_local_fail BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.m7_local_audit_failure();`);
 r=await api(item+'/images','POST',form(v,'during'),content.jar,{'Idempotency-Key':crypto.randomUUID()});check('failed finalize returns durable pending',r.status===202&&r.data.state==='upload_pending');const pending=r.data.operation_id;v++;
 check('failed finalize has no visible second image',json(`SELECT count(*)::integer FROM public.project_images WHERE project_id=${quote(p)};`)===1);
 sql('DROP TRIGGER m7_local_fail ON public.audit_logs;DROP FUNCTION public.m7_local_audit_failure();');
 check('content recovery list denied',(await api('/api/project-media/operations','GET',undefined,content.jar)).status===403);
 r=await api('/api/project-media/operations','GET',undefined,owner.jar);check('administrator recovery safe projection',r.status===200&&r.data.operations.some(x=>x.id===pending)&&r.data.operations.every(x=>!('storage_path'in x)&&!('lease_token'in x)));
 r=await api('/api/project-media/operations/'+pending+'/retry','POST',{},owner.jar);check('live upload lease not stolen',r.status===202);
 sql(`UPDATE public.project_media_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE id=${quote(pending)};`);
 r=await api('/api/project-media/operations/'+pending+'/retry','POST',{},owner.jar);check('expired pending upload cleaned through Storage',r.status===200&&r.data.deleted);v=r.data.project_version;
 r=await api(item+'/status','PATCH',{expected_version:v,status:'completed',completion_date:'2026-03-01'},owner.jar);check('project completion through API',r.status===200&&r.data.project.status==='completed');v=r.data.project.version;
 check('completed project stages frozen',(await api(item+'/stages/'+sid,'DELETE',{expected_version:v},owner.jar)).status===409);
 r=await api(item+'/status','PATCH',{expected_version:v,status:'archived'},owner.jar);check('project withdrawal',r.status===200);v=r.data.project.version;
 check('old file URL rechecks withdrawal',(await api(file)).status===404);
 check('active content preview still works',(await api(file,'GET',undefined,content.jar)).status===200);
 sql(`UPDATE public.profiles SET account_status='suspended' WHERE id=${quote(content.id)};`);
 check('stale suspended session management denied',(await api(item,'GET',undefined,content.jar)).status===403);
 check('stale suspended preview blocked',(await api(file,'GET',undefined,content.jar)).status===404);
 sql(`UPDATE public.profiles SET account_status='active' WHERE id=${quote(content.id)};`);
 r=await api(item+'/images/'+image,'DELETE',{expected_version:v},content.jar);check('actual file removal',r.status===200&&r.data.deleted);v=r.data.project_version;
 check('removed file URL unavailable',(await api(file,'GET',undefined,owner.jar)).status===404);
 r=await api(item,'DELETE',{expected_version:v},owner.jar);check('project removed after file cleanup',r.status===200&&r.data.project.deleted);
 check('exact objects removed',sql(`SELECT count(*) FROM storage.objects WHERE bucket_id='project-images' AND name LIKE ${quote(p+'/%')};`)==='0');
 check('terminal operation provenance retained',sql(`SELECT count(*) FROM public.project_media_operations WHERE bound_project_id=${quote(p)} AND project_id IS NULL AND state='deleted';`)==='2');
 // Exercise the exact Windows PowerShell helper through loopback using an ignored private copy.
 const psDirectory=`node_modules/.cache/module7/ps-${run}`;fs.mkdirSync(psDirectory+'/lib',{recursive:true});
 let helperSource=fs.readFileSync('scripts/Test-ProductionConstructionProjects.ps1','utf8');
 helperSource=helperSource.replace("$root=Split-Path $PSScriptRoot -Parent",`$root='${process.cwd().replaceAll("'","''")}'`).replace("$origin='https://bedos-construction-platform.vercel.app';$provider='https://zjdqomckldeipigqqfqm.supabase.co'",`$origin='${origin}';$provider='${base}'`).replace("$directory=Join-Path $root 'docs/module-7-evidence'",`$directory='${process.cwd().replaceAll('\\','/')}/${psDirectory}'`).replace("(Read-Host 'Existing administrator email')","$env:BEDOS_PROJECT_LOCAL_EMAIL").replace("Read-Host 'Administrator password (hidden; never send in chat)' -AsSecureString","(ConvertTo-SecureString $env:BEDOS_PROJECT_LOCAL_PASSWORD -AsPlainText -Force)");
 if(helperSource.includes("Read-Host '"))throw Error('Local helper prompt substitution incomplete');
 fs.writeFileSync(psDirectory+'/verify.ps1',helperSource);fs.copyFileSync('scripts/lib/ProductionVerification.ps1',psDirectory+'/lib/ProductionVerification.ps1');
 const psEnv={...process.env,BEDOS_PROJECT_LOCAL_EMAIL:owner.email,BEDOS_PROJECT_LOCAL_PASSWORD:owner.password};for(const k of Object.keys(psEnv))if(k.toLowerCase()==='psmodulepath')delete psEnv[k];
 const psOut=execFileSync('powershell.exe',['-NoProfile','-File',psDirectory+'/verify.ps1'],{env:psEnv,encoding:'utf8',windowsHide:true,timeout:180000,stdio:['ignore','pipe','pipe']});fs.writeFileSync(psDirectory+'/console.txt',psOut);
 const helperReport=JSON.parse(fs.readFileSync(psDirectory+'/production-project-admin.json','utf8').replace(/^\uFEFF/,'')),helperJournal=JSON.parse(fs.readFileSync(psDirectory+'/private-project-fixtures.json','utf8').replace(/^\uFEFF/,''));
 check('actual PowerShell acceptance helper passes locally',helperReport.results.length>=35&&helperReport.results.every(r=>r.pass));
 check('PowerShell journal proves five exact fixtures removed',helperJournal.actor===owner.id&&helperJournal.state==='complete'&&helperJournal.fixtures.length===5&&helperJournal.fixtures.every(f=>f.state==='deleted'));
 let verifier=fs.readFileSync('scripts/Prepare-ConstructionFixtureVerification.mjs','utf8').replace("'docs/module-7-evidence/private-project-fixtures.json'",JSON.stringify(psDirectory+'/private-project-fixtures.json')).replace("'.next/module7-release/05-independent-fixture-verification.sql'",JSON.stringify(psDirectory+'/independent.sql'));
 fs.writeFileSync(psDirectory+'/prepare.mjs',verifier);execFileSync(process.execPath,[psDirectory+'/prepare.mjs'],{windowsHide:true,stdio:'pipe'});
 const independent=JSON.parse(sql(fs.readFileSync(psDirectory+'/independent.sql','utf8')).split('\n').find(l=>l.startsWith('{')));
 check('private independent fixture audit and operation reconciliation passes locally',independent.all_passed&&Object.keys(independent.checks).length===15);
 results.push({name:'Independent fixture SQL assertion count',pass:true,assertions:Object.keys(independent.checks).length});
 const helperParents=helperJournal.fixtures.filter(f=>f.kind==='project').map(f=>f.id);if(helperParents.some(id=>!/^[a-f0-9-]{36}$/.test(id)))throw Error('Helper fixture ID guard');
 sql(`DELETE FROM public.project_media_operations WHERE bound_project_id IN(${helperParents.map(quote)});`);
 results.push({name:'Actual Windows PowerShell helper assertion count',pass:true,assertions:helperReport.results.length});
 for(const f of fixtures)check(f.role+' backend logout',(await api('/api/auth/logout','POST',{},f.jar)).status===200);
}catch(e){results.push({name:'Local construction integration stopped',pass:false,stage,error_type:e.name});}
finally{
 if(server){server.kill();await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,5000);});}if(log!==undefined)fs.closeSync(log);
 try{
  sql('DROP TRIGGER IF EXISTS m7_local_fail ON public.audit_logs;DROP FUNCTION IF EXISTS public.m7_local_audit_failure();');
  for(const f of fixtures){const r=await admin.auth.admin.getUserById(f.id);if(r.error||r.data.user?.email!==f.email||r.data.user.user_metadata?.full_name!==f.name)throw Error('Exact identity cleanup guard');}
  const objects=json(`SELECT coalesce(json_agg(name),'[]') FROM storage.objects WHERE bucket_id='project-images' AND split_part(name,'/',1) IN(${projects.length?projects.map(quote):'NULL'});`);
  if(objects.length){const r=await admin.storage.from('project-images').remove(objects);if(r.error)throw Error('Exact object cleanup failed');}
  if(installed){sql(`BEGIN;DELETE FROM public.project_images WHERE project_id IN(SELECT id FROM public.projects WHERE slug LIKE ${quote(prefix+'%')});DELETE FROM public.project_media_operations WHERE bound_project_id IN(${projects.length?projects.map(quote):'NULL'});DELETE FROM public.projects WHERE slug LIKE ${quote(prefix+'%')};DELETE FROM public.project_categories WHERE slug=${quote(prefix)};DELETE FROM public.services WHERE slug=${quote(prefix)};${fixtures.length?`DELETE FROM public.audit_logs WHERE actor_id IN(${fixtures.map(f=>quote(f.id))});`:''}COMMIT;`);}
  for(const f of fixtures)check('exact local '+f.role+' fixture removed',!(await admin.auth.admin.deleteUser(f.id)).error);
  check('local construction fixture rows absent',sql(`SELECT count(*) FROM public.projects WHERE slug LIKE ${quote(prefix+'%')};`)==='0');
 }catch{results.push({name:'Exact local fixture cleanup needs controlled review',pass:false});fs.writeFileSync('.next/module7-cleanup.json',JSON.stringify({prefix,fixtures:fixtures.map(({id,email,name})=>({id,email,name})),projects}));}
 try{
  if(installed||seeded){
   if(!bucket.length){const removed=await admin.storage.deleteBucket('project-images');if(removed.error)throw Error('Local empty bucket deletion via Storage API failed');}
   const current=funcs();sql(`BEGIN;SET LOCAL lock_timeout='5s';
   ${current.map(f=>`DROP FUNCTION public.${f.name}(${f.identity});`).join('\n')}
   DROP POLICY IF EXISTS bedos_project_storage_backend_only ON storage.objects;DROP POLICY IF EXISTS m7_local_original_read ON storage.objects;DROP POLICY IF EXISTS m7_local_original_write ON storage.objects;
   DROP TABLE IF EXISTS public.project_media_operations;DROP TABLE IF EXISTS public.project_services;
   ALTER TABLE public.projects DROP COLUMN IF EXISTS category_id,DROP COLUMN IF EXISTS version,DROP CONSTRAINT IF EXISTS projects_text_bounds,DROP CONSTRAINT IF EXISTS projects_date_order;
   DROP TABLE IF EXISTS public.project_categories;
   ALTER TABLE public.project_stages DROP CONSTRAINT IF EXISTS project_stages_order_bound,DROP CONSTRAINT IF EXISTS project_stages_text_bounds,DROP CONSTRAINT IF EXISTS project_stages_dates,DROP CONSTRAINT IF EXISTS project_stages_unique_order;
   DROP INDEX IF EXISTS public.project_images_one_primary;
   ALTER TABLE public.project_images DROP COLUMN IF EXISTS phase,DROP CONSTRAINT IF EXISTS project_images_order_bound,DROP CONSTRAINT IF EXISTS project_images_alt_bound;
   REVOKE ALL ON public.projects,public.project_images,public.project_stages FROM PUBLIC,anon,authenticated,service_role;
   ${grants.map(g=>`GRANT ${g.privilege} ON public.${g.table} TO ${g.role==='PUBLIC'?'PUBLIC':'"'+g.role+'"'}${g.grantable==='YES'?' WITH GRANT OPTION':''};`).join('\n')}
   DELETE FROM public.role_permissions WHERE permission_id IN(SELECT id FROM public.permissions WHERE name IN('projects.view','projects.manage','services.manage'));
   ${mappings.map(m=>`INSERT INTO public.role_permissions(role_id,permission_id) VALUES(${quote(m.role)},${quote(m.permission)});`).join('\n')}
   DELETE FROM public.permissions WHERE name IN('projects.view','projects.manage','services.manage') ${permissions.length?`AND id NOT IN(${permissions.map(quote)})`:''};
   ${bucket.length?`UPDATE storage.buckets SET public=${bucket[0].public},file_size_limit=${bucket[0].file_size_limit??'NULL'},allowed_mime_types=${bucket[0].allowed_mime_types?'ARRAY['+bucket[0].allowed_mime_types.map(quote)+']':'NULL'} WHERE id='project-images';`:''}
   COMMIT;NOTIFY pgrst,'reload schema';`);
   check('original project catalog restored exactly',catalog()===originalCatalog);check('temporary functions absent after restoration',funcs().length===0);check('original grants restored',JSON.stringify(json(grantsQuery))===JSON.stringify(grants));check('original permission mappings restored',JSON.stringify(json(mappingsQuery))===JSON.stringify(mappings));check('original role helper restored',sql("SELECT pg_get_functiondef('public.get_user_role()'::regprocedure);")===helper);
  }
 }catch(e){results.push({name:'Local construction schema restoration needs controlled review',pass:false,error:e.stderr?.toString().slice(-1000)||e.message});}
 fs.mkdirSync('docs/module-7-evidence',{recursive:true});fs.writeFileSync('docs/module-7-evidence/local-project-integration.json',JSON.stringify({date:new Date().toISOString(),scope:'Guarded local HTTP/Auth/PostgREST/Storage, concurrent edits and audit failure recovery; no hosted credentials',results},null,2)+'\n');console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.pass)}));if(results.some(r=>!r.pass))process.exitCode=1;
}
