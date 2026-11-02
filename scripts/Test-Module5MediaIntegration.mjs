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
const run=crypto.randomUUID(),prefix=`media-live-${run}`,fixtures=[],results=[];
let psDirectory,helperChecks=0;
let failureInstalled=false;const bucketCreated=[];const properties=[];const media=[];
let stage='preflight',installed=false,seeded=false,server,serverLog;
const check=(name,pass)=>{stage=name;results.push({name,pass:!!pass});if(!pass)throw Error('Local media check failed');};
const source=['20261101040000_secure_service_catalog.sql','20261101060000_secure_property_management.sql','20261101070000_restrict_property_writes.sql','20261101080000_secure_property_media.sql','20261101090000_restrict_property_media_access.sql'].map(n=>fs.readFileSync('supabase/migrations/'+n,'utf8')).join('\n');
const names=[...source.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)].map(x=>x[1]);
const functions=()=>json(`SELECT coalesce(json_agg(json_build_object('name',p.proname,'body',p.prosrc,'identity',pg_get_function_identity_arguments(p.oid)) ORDER BY p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${names.map(quote)});`);
const helperQuery="SELECT json_build_object('definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl::text) FROM pg_proc WHERE oid='public.get_user_role()'::regprocedure;";
const originalHelper=json(helperQuery);
const grantsQuery="SELECT coalesce(json_agg(json_build_object('table',table_name,'role',grantee,'privilege',privilege_type,'grantable',is_grantable) ORDER BY table_name,grantee,privilege_type),'[]') FROM information_schema.table_privileges WHERE table_schema='public' AND table_name IN ('properties','property_images','property_floor_plans','property_features','property_amenities') AND grantee IN ('PUBLIC','anon','authenticated','service_role');";
const originalGrants=json(grantsQuery);
const permissionsQuery="SELECT coalesce(json_agg(json_build_object('id',id,'name',name) ORDER BY name),'[]') FROM public.permissions WHERE name IN ('properties.view','properties.manage');";
const originalPermissions=json(permissionsQuery);
const mappingsQuery="SELECT coalesce(json_agg(json_build_object('role_id',rp.role_id,'permission_id',rp.permission_id) ORDER BY rp.role_id,rp.permission_id),'[]') FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id WHERE p.name IN ('properties.view','properties.manage');";
const originalMappings=json(mappingsQuery);
const bucketState=json("SELECT coalesce(json_agg(json_build_object('id',id,'public',public,'size',file_size_limit,'mimes',allowed_mime_types) ORDER BY id),'[]') FROM storage.buckets WHERE id IN ('property-images','property-floor-plans');");
const originalConstraint=sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.properties'::regclass AND conname='properties_status_check';");
const jar=()=>new Map();
async function api(path,method='GET',body,session,extra={}){
 if(!path.startsWith('/api/'))throw Error('Local API path guard failed');
 const multipart=body instanceof FormData;
 const response=await fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(45000),headers:{Connection:'close',...(body!==undefined&&!multipart?{'Content-Type':'application/json'}:{}),...(session?.size?{Cookie:[...session].map(([k,v])=>k+'='+v).join('; ')}:{}),...extra},...(body!==undefined?{body:multipart||typeof body==='string'?body:JSON.stringify(body)}:{})});
 if(session)for(const raw of response.headers.getSetCookie()){const pair=raw.split(';')[0],at=pair.indexOf('=');if(/max-age=0/i.test(raw))session.delete(pair.slice(0,at));else session.set(pair.slice(0,at),pair.slice(at+1));}
 const type=response.headers.get('content-type')||'';let data=null,bytes;if(type.startsWith('image/'))bytes=Buffer.from(await response.arrayBuffer());else try{data=await response.json();}catch{}
 return {status:response.status,data,bytes,type,cache:response.headers.get('cache-control'),nosniff:response.headers.get('x-content-type-options')};
}
async function fixture(label,role){
 const email=`${prefix}-${label}@bedos-media-live.invalid`,name=`Local media ${run} ${label}`,password=crypto.randomBytes(24).toString('base64url')+'aA1!';
 const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name}});
 const f={id:r.data.user?.id,email,name,password,role,jar:jar()};if(f.id)fixtures.push(f);
 check(`${label} exact local Auth fixture`,!r.error&&!!f.id&&r.data.user.email===email);
 sql(`UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name=${quote(role)}),account_status='active' WHERE id=${quote(f.id)};`);
 const login=await api('/api/auth/login','POST',{email,password},f.jar);check(`${label} actual backend login`,login.status===200&&login.data.user.id===f.id);
 return f;
}
const sharp=(await import('sharp')).default;
const imageBytes=await sharp({create:{width:12,height:8,channels:3,background:'blue'}}).png().withMetadata().toBuffer();
function form(extra={}){const f=new FormData();f.append('file',new Blob([imageBytes],{type:'image/png'}),'../../untrusted.svg');for(const [k,v]of Object.entries(extra))f.append(k,String(v));return f;}
const operation=id=>json(`SELECT row_to_json(o) FROM public.property_media_operations o WHERE id=${quote(id)};`);
const expire=id=>sql(`UPDATE public.property_media_operations SET lease_until=now()-interval '1 minute' WHERE id=${quote(id)} AND bound_property_id IN (${properties.map(p=>quote(p.id))});`);
async function propertyFixture(actor,label){const r=await api('/api/properties','POST',{title:`${prefix} ${label}`,slug:`${prefix}-${label}`,property_type:'test',listing_type:'test'},actor.jar);check('exact property fixture '+label,r.status===201&&r.data.property.created_by===actor.id);properties.push(r.data.property);return r.data.property;}
async function upload(actor,p,extra={},key){const r=await api(`/api/properties/${p.id}/images`,'POST',form(extra),actor.jar,key?{'Idempotency-Key':key}:{});if(r.status===201)media.push({property:p.id,id:r.data.image.id,kind:'images'});return r;}
try {
 check('temporary functions and ledger absent',functions().length===0&&sql("SELECT to_regclass('public.property_media_operations') IS NULL;")==='t');
 check('local media buckets initially empty',sql("SELECT count(*) FROM storage.objects WHERE bucket_id IN ('property-images','property-floor-plans');")==='0');
 await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(55330,'127.0.0.1',()=>s.close(resolve));});
 for(const bucket of ['property-images','property-floor-plans',prefix]){if(!bucketState.some(b=>b.id===bucket)){const r=await admin.storage.createBucket(bucket,{public:false});check('exact local private bucket created',!r.error);bucketCreated.push(bucket);}}
 seeded=true;
 sql(`BEGIN;INSERT INTO public.permissions(name) VALUES('properties.view'),('properties.manage') ON CONFLICT(name) DO NOTHING;INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.name IN ('administrator','content_manager') AND p.name IN ('properties.view','properties.manage') ON CONFLICT DO NOTHING;
 ${fs.readFileSync('supabase/migrations/20261029000000_restrict_role_lookup_to_active_accounts.sql','utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'')}
 CREATE POLICY bedos_media_local_storage_allow ON storage.objects FOR ALL TO anon,authenticated USING(bucket_id IN ('property-images','property-floor-plans',${quote(prefix)})) WITH CHECK(bucket_id IN ('property-images','property-floor-plans',${quote(prefix)}));COMMIT;`);
 installed=true;sql(source);
 fs.mkdirSync('node_modules/.cache',{recursive:true});serverLog=fs.openSync(`node_modules/.cache/media-live-${run}.log`,'w');
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','55330'],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:base,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:anonKey,SUPABASE_SERVICE_ROLE_KEY:serviceKey,BEDOS_APP_ORIGIN:origin,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore',serverLog,serverLog]});
 const deadline=Date.now()+90000;let ready=false;while(Date.now()<deadline){if(server.exitCode!==null)throw Error('Local server exited');try{const r=await api('/api/properties');if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,400));}check('actual local media backend ready',ready);
 const owner=await fixture('administrator','administrator'),staff=await fixture('content','content_manager'),customer=await fixture('customer','customer'),finance=await fixture('finance','finance');
 const p=await propertyFixture(owner,'gallery'),other=await propertyFixture(owner,'other');
 let r=await api(`/api/properties/${p.id}/images`);check('anonymous draft gallery hidden',r.status===404);
 for(const f of [customer,finance]){r=await api(`/api/properties/${p.id}/images`,'POST',form(),f.jar);check(f.role+' upload denied',r.status===403);}
 r=await api(`/api/properties/${p.id}/images`,'POST',form());check('anonymous upload denied',r.status===401);
 r=await upload(staff,p,{is_primary:'maybe'});check('invalid metadata causes no storage side effect',r.status===400&&sql(`SELECT count(*) FROM public.property_media_operations WHERE bound_property_id=${quote(p.id)};`)==='0');
 const key=crypto.randomUUID();r=await upload(staff,p,{is_primary:true,display_order:2,alt_text:'Fixture'},key);check('manager uploads real normalized image on draft',r.status===201&&!('storage_path' in r.data.image));const first=r.data.image;
 r=await upload(staff,p,{is_primary:true,display_order:2,alt_text:'Fixture'},key);check('same idempotency key returns exact existing image',r.status===201&&r.data.image.id===first.id);media.pop();
 r=await api(first.image_url,'GET',undefined,staff.jar);check('staff draft file preview returns validated bytes',r.status===200&&r.type==='image/png'&&r.nosniff==='nosniff'&&r.cache==='private, no-store'&&!(await sharp(r.bytes).metadata()).exif);
 r=await api(first.image_url);check('public draft file hidden',r.status===404);
 const parallel=await Promise.all([upload(staff,p,{is_primary:true}),upload(staff,p,{is_primary:true})]);check('concurrent primary uploads both finish',parallel.every(x=>x.status===201));
 check('exactly one primary after concurrent requests',sql(`SELECT count(*) FROM public.property_images WHERE property_id=${quote(p.id)} AND is_primary;`)==='1');
 r=await api(`/api/properties/${p.id}/images`,'GET',undefined,staff.jar);check('bounded draft gallery and owned URLs',r.status===200&&r.data.images.length===3&&r.data.pagination.total===3&&r.data.images.every(x=>x.image_url.startsWith(`/api/properties/${p.id}/`)&&!('storage_path' in x)));
 r=await api(`/api/properties/${other.id}/images/${first.id}`,'PATCH',{alt_text:'Wrong property'},owner.jar);check('cross-property image edit denied',r.status===404);
 r=await api(`/api/properties/${p.id}/floor-plans`,'POST',form({title:'Plan',description:'Test plan'}),staff.jar);check('real floor plan upload',r.status===201);media.push({property:p.id,id:r.data.floorPlan.id,kind:'floor-plans'});const plan=r.data.floorPlan;
 for(const [kind,keyName]of [['features','feature'],['amenities','amenity']]){r=await api(`/api/properties/${p.id}/${kind}`,'POST',{name:'Test '+kind},staff.jar);check(kind+' creation',r.status===201);const id=r.data[keyName].id;r=await api(`/api/properties/${p.id}/${kind}/${id}`,'PATCH',{name:'Updated '+kind},staff.jar);check(kind+' edit',r.status===200);r=await api(`/api/properties/${p.id}/${kind}/${id}`,'DELETE',undefined,staff.jar);check(kind+' manager delete denied',r.status===403);}
 r=await api(`/api/properties/${p.id}/status`,'PATCH',{status:'published',expected_status:'draft',reason:'Local media publication'},owner.jar);check('property publication',r.status===200);
 r=await api(first.image_url);check('published image public file access',r.status===200&&r.bytes.length>0);
 r=await api(plan.image_url);check('published floor plan public file access',r.status===200);
 r=await api(`/api/properties/${p.id}/images?page=2&limit=3`);check('empty gallery page retains count',r.status===200&&r.data.images.length===0&&r.data.pagination.total===3);
 const token=await createClient(base,anonKey,options).auth.signInWithPassword({email:customer.email,password:customer.password});check('local customer provider login',!!token.data.session);const direct=createClient(base,anonKey,{...options,global:{headers:{Authorization:'Bearer '+token.data.session.access_token}}});
 const path=json(`SELECT to_json(storage_path) FROM public.property_media_operations WHERE media_id=${quote(first.id)};`);
 for(const sdk of [anonymous,direct]){let d=await sdk.storage.from('property-images').list(`properties/${p.id}`);check('direct property bucket listing exposes no files',!!d.error||d.data.length===0);d=await sdk.storage.from('property-images').upload(`properties/${p.id}/bypass.png`,imageBytes,{contentType:'image/png'});check('direct property upload denied',!!d.error);d=await sdk.storage.from('property-images').download(path);check('direct property download denied',!!d.error);d=await sdk.storage.from('property-images').update(path,imageBytes,{contentType:'image/png'});check('direct property update denied',!!d.error);d=await sdk.storage.from('property-images').remove([path]);check('direct property deletion does not remove object',!!d.error||d.data.length===0);}
 let d=await anonymous.storage.from(prefix).upload('unrelated.png',imageBytes,{contentType:'image/png'});check('unrelated bucket upload policy unchanged',!d.error);d=await anonymous.storage.from(prefix).download('unrelated.png');check('unrelated bucket download unchanged',!d.error);d=await anonymous.storage.from(prefix).remove(['unrelated.png']);check('unrelated bucket deletion unchanged',!d.error);
 r=await api(`/api/properties/${p.id}/status`,'PATCH',{status:'unavailable',expected_status:'published',reason:'Media withdrawal verification'},owner.jar);check('property withdrawal',r.status===200);r=await api(first.image_url);check('previous owned URL rechecks withdrawn publication',r.status===404);
 // Actual Storage upload failure: no object exists, but the durable operation remains recoverable.
 sql("UPDATE storage.buckets SET file_size_limit=1 WHERE id='property-images';");r=await upload(staff,other);check('provider upload failure returns pending operation',r.status===202&&r.data.operation_id);const failedUpload=r.data.operation_id;sql("UPDATE storage.buckets SET file_size_limit=3145728 WHERE id='property-images';");expire(failedUpload);r=await api(`/api/property-media/operations/${failedUpload}/retry`,'POST',{},owner.jar);check('failed upload without object cleaned idempotently',r.status===200&&r.data.deleted);
 // Actual finalize audit failure must not cause deletion of a potentially committed upload.
 sql(`CREATE FUNCTION public.bedos_media_local_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='property_image_created' THEN RAISE EXCEPTION 'Local audit control' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;CREATE TRIGGER bedos_media_local_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.bedos_media_local_audit_failure();`);failureInstalled=true;
 r=await upload(staff,other);check('finalize failure leaves recoverable uploaded operation',r.status===202&&r.data.operation_id);const failedFinalize=r.data.operation_id;const failedOp=operation(failedFinalize);d=await admin.storage.from(failedOp.bucket_id).download(failedOp.storage_path);check('uploaded object retained after failed finalize',!d.error);check('failed finalize created no media row',sql(`SELECT count(*) FROM public.property_images WHERE id=${quote(failedOp.media_id)};`)==='0');sql('DROP TRIGGER bedos_media_local_audit ON public.audit_logs;DROP FUNCTION public.bedos_media_local_audit_failure();');failureInstalled=false;expire(failedFinalize);r=await api(`/api/property-media/operations/${failedFinalize}/retry`,'POST',{},owner.jar);check('failed finalize object recovered and removed',r.status===200&&r.data.deleted);
 // Inject a transaction failure in the real Storage removal path for one exact local object.
 sql(`CREATE FUNCTION public.bedos_media_local_storage_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF OLD.bucket_id='property-images' AND OLD.name=${quote(path)} THEN RAISE EXCEPTION 'Local removal control';END IF;RETURN OLD;END;$$;CREATE TRIGGER bedos_media_local_remove BEFORE DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.bedos_media_local_storage_failure();`);
 r=await api(`/api/properties/${p.id}/images/${first.id}`,'DELETE',undefined,owner.jar);check('real Storage removal failure returns pending',r.status===202&&r.data.operation_id);const pendingDeletion=r.data.operation_id;
 check('failed removal retains child and durable cleanup',sql(`SELECT count(*) FROM public.property_images WHERE id=${quote(first.id)};`)==='1'&&operation(pendingDeletion).state==='cleanup_pending');r=await api(first.image_url,'GET',undefined,staff.jar);check('cleanup-pending file hidden even from preview',r.status===404);
 sql('DROP TRIGGER bedos_media_local_remove ON storage.objects;DROP FUNCTION public.bedos_media_local_storage_failure();');expire(pendingDeletion);r=await api(`/api/property-media/operations/${pendingDeletion}/retry`,'POST',{},owner.jar);check('failed removal retry completes physical and metadata deletion',r.status===200&&r.data.deleted);
 // Recheck a retained terminal record if a delayed external write appears after cleanup.
 const deletedOp=operation(pendingDeletion);d=await admin.storage.from(deletedOp.bucket_id).upload(deletedOp.storage_path,imageBytes,{contentType:'image/png'});check('controlled late-write fixture created',!d.error);r=await api(`/api/property-media/operations/${pendingDeletion}/retry`,'POST',{},owner.jar);check('retained terminal operation safely rechecks late write',r.status===200&&r.data.deleted);d=await admin.storage.from(deletedOp.bucket_id).download(deletedOp.storage_path);check('late object removed without duplicate media deletion audit',!!d.error&&sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id=${quote(first.id)} AND action='property_image_deleted';`)==='1');
 r=await api('/api/property-media/operations','GET',undefined,staff.jar);check('manager cannot inspect recovery ledger',r.status===403);r=await api('/api/property-media/operations','GET',undefined,owner.jar);check('admin ledger has bounded safe fields',r.status===200&&r.data.operations.every(x=>!('storage_path'in x)&&!('lease_token'in x)));
 for(const m of media.filter(x=>x.id!==first.id)){r=await api(`/api/properties/${m.property}/${m.kind}/${m.id}`,'DELETE',undefined,owner.jar);check('exact file removed through API',r.status===200);}
 for(const p of properties){r=await api(`/api/properties/${p.id}`,'DELETE',undefined,owner.jar);check('exact local property removed through API',r.status===200);}

 stage='Windows PowerShell media workflow';psDirectory=process.cwd().replaceAll('\\','/')+'/.next/media-ps-'+run;fs.mkdirSync(psDirectory,{recursive:true});
 const psQuote=value=>"'"+value.replaceAll("'","''")+"'";
 let ps=fs.readFileSync('scripts/Test-ProductionPropertyMedia.ps1','utf8').replace("$root=Split-Path $PSScriptRoot -Parent",'$root='+psQuote(process.cwd())).replace("$directory=Join-Path $root 'docs/module-5-evidence'",'$directory='+psQuote(psDirectory)).replace(". (Join-Path $PSScriptRoot 'lib/ProductionVerification.ps1')",'. '+psQuote(process.cwd()+'/scripts/lib/ProductionVerification.ps1')).replaceAll('https://bedos-construction-platform.vercel.app',origin).replaceAll('https://zjdqomckldeipigqqfqm.supabase.co',base);
 if(ps.includes('https://bedos-construction-platform.vercel.app')||ps.includes('https://zjdqomckldeipigqqfqm.supabase.co'))throw Error('Local PowerShell destination guard failed');
 ps='function Read-Host { param([string]$Prompt,[switch]$AsSecureString) if($AsSecureString){return ConvertTo-SecureString -String $env:BEDOS_MEDIA_LOCAL_PASSWORD -AsPlainText -Force};return $env:BEDOS_MEDIA_LOCAL_EMAIL }\n'+ps;
 fs.writeFileSync(psDirectory+'/verify.ps1',ps);const psEnv={...process.env,BEDOS_MEDIA_LOCAL_EMAIL:owner.email,BEDOS_MEDIA_LOCAL_PASSWORD:owner.password};for(const key of Object.keys(psEnv))if(key.toLowerCase()==='psmodulepath')delete psEnv[key];
 const psOutput=execFileSync('powershell.exe',['-NoProfile','-File',psDirectory+'/verify.ps1'],{env:psEnv,encoding:'utf8',windowsHide:true,timeout:120000,stdio:['ignore','pipe','pipe']});fs.writeFileSync(psDirectory+'/console.txt',psOutput);
 const psReport=JSON.parse(fs.readFileSync(psDirectory+'/production-media-admin.json','utf8').replace(/^\uFEFF/,'')),psJournal=JSON.parse(fs.readFileSync(psDirectory+'/private-media-fixtures.json','utf8').replace(/^\uFEFF/,''));
 helperChecks=psReport.results.length;
 check('production PowerShell workflow passes against guarded local Storage',helperChecks>=40&&psReport.results.every(x=>x.pass));check('PowerShell removes all seven exact fixtures',psJournal.state==='complete'&&psJournal.fixtures.length===7&&psJournal.fixtures.every(f=>f.state==='deleted'));check('PowerShell administrator logout succeeds',psReport.results.some(x=>x.name==='Administrator logout'&&x.http_status===200));
 for(const f of fixtures){r=await api('/api/auth/logout','POST',{},f.jar);check(f.role+' backend logout',r.status===200);}
} catch(error){results.push({name:'Local media integration stopped',pass:false,stage,error_type:error.name});}
finally {
 if(server){server.kill();await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,5000);});}if(serverLog!==undefined)fs.closeSync(serverLog);
 try {
  if(installed)sql(`DROP TRIGGER IF EXISTS bedos_media_local_remove ON storage.objects;DROP FUNCTION IF EXISTS public.bedos_media_local_storage_failure();${failureInstalled?'DROP TRIGGER IF EXISTS bedos_media_local_audit ON public.audit_logs;DROP FUNCTION IF EXISTS public.bedos_media_local_audit_failure();':''}`);
  for(const f of fixtures){const r=await admin.auth.admin.getUserById(f.id);if(r.error||r.data.user?.email!==f.email||r.data.user.user_metadata?.full_name!==f.name)throw Error('Auth cleanup identity guard failed');}

  if(psDirectory&&fs.existsSync(psDirectory+'/private-media-fixtures.json')){
   const journal=JSON.parse(fs.readFileSync(psDirectory+'/private-media-fixtures.json','utf8').replace(/^\uFEFF/,''));if(!fixtures.some(f=>f.id===journal.actor))throw Error('Local PowerShell actor guard failed');
   for(const f of journal.fixtures.filter(x=>x.kind==='properties')){
    if(!/^bedos-media-[a-f0-9]{32}-(gallery|cross-parent)$/.test(f.slug)||!f.title.startsWith('Temporary verification '))throw Error('Local PowerShell property guard failed');
    const rows=json(`SELECT coalesce(json_agg(p),'[]') FROM (SELECT id,slug,created_by,title FROM public.properties WHERE slug=${quote(f.slug)}) p;`);if(rows.some(p=>p.slug!==f.slug||p.title!==f.title||p.created_by!==journal.actor||(f.id&&p.id!==f.id)))throw Error('PowerShell property ownership mismatch');if(f.id)properties.push(f);else if(rows.length)properties.push({...f,id:rows[0].id});
   }
  }
  const ids=fixtures.map(f=>quote(f.id)).join(','),pids=properties.map(p=>quote(p.id)).join(',');
  if(installed&&pids){const ops=json(`SELECT coalesce(json_agg(o),'[]') FROM public.property_media_operations o WHERE bound_property_id IN (${pids});`);for(const op of ops){if(!fixtures.some(f=>f.id===op.actor_id)||!op.storage_path.startsWith(`properties/${op.bound_property_id}/${op.id}.`)||op.bucket_id!==(op.kind==='images'?'property-images':'property-floor-plans'))throw Error('Exact object cleanup guard failed');const r=await admin.storage.from(op.bucket_id).remove([op.storage_path]);if(r.error)throw Error('Object cleanup failed');}
   sql(`BEGIN;DELETE FROM public.property_images WHERE property_id IN (${pids});DELETE FROM public.property_floor_plans WHERE property_id IN (${pids});DELETE FROM public.properties WHERE id IN (${pids}) AND created_by IN (${ids});DELETE FROM public.property_media_operations WHERE bound_property_id IN (${pids});COMMIT;`);
  }
  if(ids)sql(`DELETE FROM public.audit_logs WHERE actor_id IN (${ids});`);
  for(const f of fixtures){const r=await admin.auth.admin.deleteUser(f.id);check('exact local Auth fixture removed',!r.error);}
  if(bucketCreated.includes(prefix)){await admin.storage.from(prefix).remove(['unrelated.png']);}
  check('no property objects remain after exact cleanup',sql("SELECT count(*) FROM storage.objects WHERE bucket_id IN ('property-images','property-floor-plans');")==='0');
  for(const bucket of bucketCreated){const r=await admin.storage.deleteBucket(bucket);check('exact created bucket removed',!r.error);}
 } catch {results.push({name:'Local media fixture cleanup needs review',pass:false});fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/media-local-cleanup.json',JSON.stringify({prefix,fixtures:fixtures.map(({id,email,name})=>({id,email,name})),properties,bucketCreated}));}
 try {
  if(installed||seeded){const current=functions();if(installed)check('temporary function bodies match installed source',current.length===names.length&&current.every(f=>f.body.replace(/\s+/g,'')===source.slice(source.indexOf(`CREATE FUNCTION public.${f.name}(`)).split('$function$')[1].replace(/\s+/g,'')));
   sql(`BEGIN;SET LOCAL lock_timeout='5s';DROP POLICY IF EXISTS bedos_property_storage_backend_only ON storage.objects;DROP POLICY IF EXISTS bedos_media_local_storage_allow ON storage.objects;
   DROP TRIGGER IF EXISTS viewing_property_publication_guard ON public.viewing_requests;DROP TRIGGER IF EXISTS enquiry_property_publication_guard ON public.enquiries;
   DROP TABLE IF EXISTS public.property_media_operations;${current.map(f=>`DROP FUNCTION public.${f.name}(${f.identity});`).join('\n')}
   DROP INDEX IF EXISTS public.property_images_one_primary_idx;ALTER TABLE public.property_images DROP CONSTRAINT IF EXISTS property_images_order_check;ALTER TABLE public.property_floor_plans DROP CONSTRAINT IF EXISTS property_floor_plans_order_check;
   ALTER TABLE public.properties DROP CONSTRAINT properties_status_check;ALTER TABLE public.properties ADD CONSTRAINT properties_status_check ${originalConstraint};
   REVOKE ALL ON public.properties,public.property_images,public.property_floor_plans,public.property_features,public.property_amenities FROM PUBLIC,anon,authenticated,service_role;
   ${originalGrants.map(g=>`GRANT ${g.privilege} ON public.${g.table} TO ${g.role==='PUBLIC'?'PUBLIC':'"'+g.role+'"'}${g.grantable==='YES'?' WITH GRANT OPTION':''};`).join('\n')}
   ${bucketState.map(b=>`UPDATE storage.buckets SET public=${b.public},file_size_limit=${b.size??'NULL'},allowed_mime_types=${b.mimes?`ARRAY[${b.mimes.map(quote)}]`:'NULL'} WHERE id=${quote(b.id)};`).join('\n')}
   ${originalHelper.definition};DELETE FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE name IN ('properties.view','properties.manage'));
   ${originalMappings.map(m=>`INSERT INTO public.role_permissions(role_id,permission_id) VALUES(${quote(m.role_id)},${quote(m.permission_id)});`).join('\n')}
   DELETE FROM public.permissions WHERE name IN ('properties.view','properties.manage') ${originalPermissions.length?`AND id NOT IN (${originalPermissions.map(p=>quote(p.id))})`:''};COMMIT;NOTIFY pgrst,'reload schema';`);
   check('original grants restored',JSON.stringify(json(grantsQuery))===JSON.stringify(originalGrants));check('original helper restored',JSON.stringify(json(helperQuery))===JSON.stringify(originalHelper));check('original permission mappings restored',JSON.stringify(json(permissionsQuery))===JSON.stringify(originalPermissions)&&JSON.stringify(json(mappingsQuery))===JSON.stringify(originalMappings));check('temporary functions removed',functions().length===0);
  }
 } catch {results.push({name:'Local media dependency restoration needs review',pass:false});}
 const report={date:new Date().toISOString(),production_helper_local_assertions:helperChecks,scope:'Real local Next/Auth/Storage/RLS and controlled failure recovery only; no production credentials or requests',results};fs.mkdirSync('docs/module-5-evidence',{recursive:true});fs.writeFileSync('docs/module-5-evidence/local-media-integration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:results.length,failed:results.filter(x=>!x.pass).length,results}));if(results.some(x=>!x.pass))process.exitCode=1;
}
