// Actual shared service + local DB/Auth/Mailpit only. No production environment keys.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
const container='supabase_db_bedos-supabase-lab';
const inspect=name=>JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8',windowsHide:true}))[0];
const db=inspect(container),auth=inspect('supabase_auth_bedos-supabase-lab');
const env=new Map(auth.Config.Env.map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
if(db.Name!==`/${container}`||!db.Config.Image.includes('supabase/postgres')||!env.get('GOTRUE_DB_DATABASE_URL')?.includes(container)||env.get('GOTRUE_SMTP_HOST')!=='supabase_inbucket_bedos-supabase-lab')throw Error('Local DB/Auth/mail guard failed');
const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
function jwt(role){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+1800})).toString('base64url');return`${h}.${p}.`+crypto.createHmac('sha256',env.get('GOTRUE_JWT_SECRET')).update(`${h}.${p}`).digest('base64url');}
const base='http://127.0.0.1:55321',origin='http://127.0.0.1:3000',options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(base,jwt('service_role'),options),run=crypto.randomUUID(),fixtures=[],results=[];
const cache=path.resolve('node_modules/.cache',`bedos-staff-resume-${run}`);fs.mkdirSync(cache,{recursive:true});
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
fs.writeFileSync(path.join(cache,'api-error.mjs'),transpile(fs.readFileSync('src/server/http/api-error.ts','utf8')));
const serviceCode=transpile(fs.readFileSync('src/features/users/staff-invitation.service.ts','utf8')).replaceAll('@/server/http/api-error','./api-error.mjs');
if(serviceCode.includes('@/'))throw Error('Unexpected integration import dependency');
fs.writeFileSync(path.join(cache,'staff-invitation.service.mjs'),serviceCode);
const {resumeStaffInvitation,retryStaffInvitation}=await import(pathToFileURL(path.join(cache,'staff-invitation.service.mjs')).href);
const source=fs.readFileSync('supabase/migrations/20261101020000_add_trusted_staff_setup_resume.sql','utf8');
let installed=false,triggerTable=null,actor,finance,stage='local setup';
const check=(name,pass)=>{results.push({name,pass:!!pass});if(!pass)throw Error(name);};
async function expectStatus(name,fn,status){let caught;try{await fn();}catch(e){caught=e;}check(name,caught?.status===status);}
const resume=f=>resumeStaffInvitation(admin,f.id,actor.id,'Local trusted setup recovery',origin);
function clearTrigger(){if(triggerTable){sql(`DROP TRIGGER bedos_setup_integration_failure ON public.${triggerTable};DROP FUNCTION public.bedos_setup_integration_failure();`);triggerTable=null;}}
function failTrigger(table,f,action){
 if(!['profiles','audit_logs'].includes(table)||!/^[a-f0-9-]{36}$/.test(f.id)||!['staff_invitation_authorized','staff_invitation_retry_accepted'].includes(action))throw Error('Failure injection guard failed');
 clearTrigger();const predicate=table==='profiles'?`NEW.id='${f.id}'::uuid`:`NEW.entity_id='${f.id}'::uuid AND NEW.action='${action}'`;
 sql(`BEGIN;CREATE FUNCTION public.bedos_setup_integration_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'Synthetic local failure' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;CREATE TRIGGER bedos_setup_integration_failure BEFORE ${table==='profiles'?'UPDATE':'INSERT'} ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.bedos_setup_integration_failure();COMMIT;`);triggerTable=table;
}
async function fixture(label,{marked=true,confirmed=false,password}={}){
 const email=`setup-${run}-${label}@bedos-setup-live.invalid`,name=`Local setup ${run} ${label}`;
 const marker={version:1,request_id:crypto.randomUUID(),requested_role_id:finance,created_by:actor?.id,email,full_name:name,phone:null};
 const created=await admin.auth.admin.createUser({email,password,email_confirm:confirmed,user_metadata:{full_name:name,bedos_staff_onboarding_pending:marked},...(marked?{app_metadata:{bedos_staff_invitation:marker}}:{})});
 const f={id:created.data.user?.id,email,name,marker};if(f.id)fixtures.push(f);check(`${label} exact fixture created`,!created.error&&!!f.id&&created.data.user.email===email);return f;
}
async function acceptEmail(f,type){
 let html='';for(let i=0;i<20;i++){const r=await fetch(`http://127.0.0.1:55324/view/latest.html?query=${encodeURIComponent('to:'+f.email)}`);if(r.ok){html=await r.text();break;}await new Promise(r=>setTimeout(r,200));}
 const urls=[...html.matchAll(/https?:\/\/[^\s<>"']+/g)].map(x=>new URL(x[0].replaceAll('&amp;','&')));
 const link=urls.find(u=>u.origin===base&&u.pathname==='/auth/v1/verify'&&u.searchParams.get('type')===type);check(`${type} local email has guarded link`,!!link);
 const verified=await fetch(link,{redirect:'manual'}),landing=new URL(verified.headers.get('location')||'http://invalid.invalid');
 check(`${type} lands on trusted root`,verified.status===303&&landing.origin===origin&&landing.pathname==='/');
 const tokens=new URLSearchParams(landing.hash.slice(1));f.client=createClient(base,jwt('anon'),{auth:{...options.auth,flowType:'pkce'}});
 const session=await f.client.auth.setSession({access_token:tokens.get('access_token'),refresh_token:tokens.get('refresh_token')});
 check(`${type} session belongs to exact fixture`,!session.error&&session.data.user?.id===f.id&&!!session.data.user.email_confirmed_at);
}
async function setPassword(f){const r=await f.client.auth.updateUser({password:crypto.randomBytes(24).toString('base64url')+'aA1!'});check('fixture owner changes password',!r.error&&r.data.user?.id===f.id);}
async function verifyRolledBack(f,label){
 const p=await admin.from('profiles').select('role_id,account_status').eq('id',f.id).single(),r=await admin.from('roles').select('id').eq('name','customer').single(),i=await admin.from('staff_invitations').select('id').eq('user_id',f.id);
 check(`${label} profile and approval rolled back`,!p.error&&!r.error&&!i.error&&p.data.role_id===r.data.id&&p.data.account_status==='inactive'&&i.data.length===0);
}
async function rewind(f){sql(`UPDATE public.staff_invitations SET last_retry_at=now()-INTERVAL '61 seconds' WHERE user_id='${f.id}'::uuid;`);await new Promise(r=>setTimeout(r,1200));}
try{
 check('local setup function absent',sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bedos_setup_staff_invitation';")==='0');
 check('local injection helpers absent',sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bedos_setup_integration_failure';")==='0');
 sql(source+"\nNOTIFY pgrst,'reload schema';");installed=true;
 let ready;for(let i=0;i<30;i++){ready=await admin.rpc('bedos_setup_staff_invitation',{p_user_id:crypto.randomUUID(),p_actor_id:crypto.randomUUID(),p_reason:'Readiness',p_resume:true});if(ready.error?.code==='42501')break;await new Promise(r=>setTimeout(r,200));}check('setup RPC schema ready',ready?.error?.code==='42501');
 actor=await fixture('actor',{marked:false,confirmed:true});
 const role=await admin.from('roles').select('id').eq('name','administrator').single();check('administrator role resolved',!role.error&&!!role.data?.id);
 let r=await admin.from('profiles').update({role_id:role.data.id,account_status:'active'}).eq('id',actor.id).select('id').single();check('exact local actor configured',!r.error&&r.data?.id===actor.id);
 const ordinary=await admin.from('roles').select('id').eq('name','finance').single();check('bound role resolved',!ordinary.error&&!!ordinary.data?.id);finance=ordinary.data.id;
 stage='profile and approval rollback';const first=await fixture('early');
 failTrigger('profiles',first,'staff_invitation_authorized');await expectStatus('profile failure prevents dispatch',()=>resume(first),500);clearTrigger();await verifyRolledBack(first,'profile failure');
 failTrigger('audit_logs',first,'staff_invitation_authorized');await expectStatus('approval audit failure prevents dispatch',()=>resume(first),500);clearTrigger();await verifyRolledBack(first,'approval audit failure');
 stage='concurrent resume';const race=await Promise.allSettled([resume(first),resume(first)]);
 check('concurrent resume has one accepted dispatch and cooldown loser',race.filter(x=>x.status==='fulfilled').length===1&&race.filter(x=>x.status==='rejected'&&x.reason.status===429).length===1);
 const approved=await admin.from('audit_logs').select('id').eq('entity_id',first.id).eq('action','staff_invitation_authorized');check('concurrent setup creates one approval audit',!approved.error&&approved.data?.length===1);
 await acceptEmail(first,'invite');r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:first.id,p_actor_id:actor.id});check('resumed invite alone cannot activate staff',r.error?.code==='22023');
 await setPassword(first);r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:first.id,p_actor_id:actor.id});check('resumed invite activates only after owner password change',!r.error&&!!r.data);
 await expectStatus('activated account cannot resume setup',()=>resume(first),409);
 stage='missing post-send baseline';const late=await fixture('late-baseline');
 r=await admin.rpc('bedos_setup_staff_invitation',{p_user_id:late.id,p_actor_id:actor.id,p_reason:'Initial setup',p_resume:false});check('late failure has trusted initial setup',!r.error&&!!r.data);
 r=await admin.auth.admin.inviteUserByEmail(late.email,{redirectTo:`${origin}/`});check('initial email accepted before simulated baseline failure',!r.error&&r.data.user?.id===late.id);
 await new Promise(r=>setTimeout(r,1200));const resumed=await resume(late);check('missing baseline repaired through shared retry',resumed.recovery_method==='invite');
 await acceptEmail(late,'invite');r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:late.id,p_actor_id:actor.id});check('re-sent email does not fake password change',r.error?.code==='22023');
 await setPassword(late);r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:late.id,p_actor_id:actor.id});check('late baseline recovery activates with genuine password change',!r.error&&!!r.data);
 stage='accepted email outcome audit failure';const outcome=await fixture('outcome');
 failTrigger('audit_logs',outcome,'staff_invitation_retry_accepted');await expectStatus('accepted email audit failure returns error',()=>resume(outcome),500);clearTrigger();
 const state=await admin.from('staff_invitations').select('password_baseline_digest,last_retry_completed_at').eq('user_id',outcome.id).single();check('preparation proof retained after outcome rollback',!state.error&&!!state.data?.password_baseline_digest&&state.data.last_retry_completed_at===null);
 const originalBaseline=state.data.password_baseline_digest;await acceptEmail(outcome,'invite');await setPassword(outcome);
 await rewind(outcome);const retried=await resume(outcome);check('already-confirmed owner uses recovery after prior failure',retried.recovery_method==='recovery');
 const after=await admin.from('staff_invitations').select('password_baseline_digest').eq('user_id',outcome.id).single();check('established baseline preserved after owner already set password',!after.error&&after.data?.password_baseline_digest===originalBaseline);
 await acceptEmail(outcome,'recovery');await setPassword(outcome);r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:outcome.id,p_actor_id:actor.id});check('outcome audit recovery completes onboarding',!r.error&&!!r.data);
 stage='setup versus existing retry';const retryRace=await fixture('retry-race');
 const retryResults=await Promise.allSettled([resume(retryRace),retryStaffInvitation(admin,retryRace.id,actor.id,origin)]);
 check('setup and existing retry have one accepted dispatch',retryResults.filter(x=>x.status==='fulfilled').length===1&&retryResults.filter(x=>x.status==='rejected'&&[409,429].includes(x.reason.status)).length===1);
 stage='setup versus revocation';const revoked=await fixture('revoke-race');
 r=await admin.rpc('bedos_setup_staff_invitation',{p_user_id:revoked.id,p_actor_id:actor.id,p_reason:'Initial setup',p_resume:false});check('revocation race starts with trusted pending record',!r.error&&!!r.data);
 const revokeResults=await Promise.allSettled([resume(revoked),admin.rpc('bedos_revoke_staff_invitation',{p_user_id:revoked.id,p_actor_id:actor.id})]);
 check('resume revocation race has valid serial outcome',revokeResults[1].status==='fulfilled'&&!revokeResults[1].value.error&&(revokeResults[0].status==='fulfilled'||revokeResults[0].reason?.status===409));
 const revokedState=await admin.from('staff_invitations').select('status').eq('user_id',revoked.id).single();check('resume cannot reopen revoked record',!revokedState.error&&revokedState.data?.status==='revoked');
 r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:revoked.id,p_actor_id:actor.id});check('revoked race target cannot activate',r.error?.code==='22023');
 stage='setup versus activation';const activationPassword=crypto.randomBytes(24).toString('base64url')+'aA1!',activation=await fixture('activate-race',{confirmed:true,password:activationPassword});
 r=await admin.rpc('bedos_setup_staff_invitation',{p_user_id:activation.id,p_actor_id:actor.id,p_reason:'Initial setup',p_resume:false});check('activation race starts with trusted record',!r.error&&!!r.data);
 r=await admin.rpc('bedos_record_staff_invitation_password_baseline',{p_user_id:activation.id});check('activation race has password baseline',!r.error&&!!r.data);
 activation.client=createClient(base,jwt('anon'),options);r=await activation.client.auth.signInWithPassword({email:activation.email,password:activationPassword});check('activation race owner session verified',!r.error&&r.data.user?.id===activation.id);await setPassword(activation);
 const activationResults=await Promise.allSettled([resume(activation),admin.rpc('bedos_activate_staff_invitation',{p_user_id:activation.id,p_actor_id:actor.id})]);
 check('resume activation race has valid serial outcome',activationResults[1].status==='fulfilled'&&!activationResults[1].value.error&&(activationResults[0].status==='fulfilled'||activationResults[0].reason?.status===409));
 const activationState=await admin.from('staff_invitations').select('status').eq('user_id',activation.id).single();check('resume cannot revert completed activation',!activationState.error&&activationState.data?.status==='activated');
 stage='mutable metadata forgery';const password=crypto.randomBytes(24).toString('base64url')+'aA1!',forged=await fixture('forged',{marked:false,confirmed:true,password});
 forged.client=createClient(base,jwt('anon'),options);r=await forged.client.auth.signInWithPassword({email:forged.email,password});check('ordinary fixture provider session established',!r.error&&r.data.user?.id===forged.id);
 const forgedMarker={...first.marker,email:forged.email};await forged.client.auth.updateUser({app_metadata:{bedos_staff_invitation:forgedMarker},data:{bedos_staff_onboarding_pending:true,bedos_staff_invitation:forgedMarker}});
 const stored=await admin.auth.admin.getUserById(forged.id);check('public Auth cannot create server-owned provenance',!stored.error&&!stored.data.user?.app_metadata?.bedos_staff_invitation);
 await expectStatus('forged mutable metadata cannot convert customer',()=>resume(forged),403);
}catch{results.push({name:'Local shared-service integration stopped',pass:false,stage});}
finally{
 try{clearTrigger();}catch{results.push({name:'Local failure trigger cleanup needs review',pass:false});}
 try{
  for(const f of fixtures){if(f.client)await f.client.auth.signOut({scope:'local'});const u=await admin.auth.admin.getUserById(f.id);if(!/^[a-f0-9-]{36}$/.test(f.id)||u.error||u.data.user?.email!==f.email||u.data.user.user_metadata?.full_name!==f.name)throw Error('Exact fixture guard failed');}
  const ids=fixtures.map(f=>`'${f.id}'`).join(',');if(ids)sql(`BEGIN;DELETE FROM public.staff_invitations WHERE user_id IN (${ids});DELETE FROM public.audit_logs WHERE actor_id IN (${ids}) AND entity_id IN (${ids});COMMIT;`);
  for(const f of fixtures){const d=await admin.auth.admin.deleteUser(f.id);check('exact local setup fixture removed',!d.error);}
  check('no local setup integration users remain',sql(`SELECT count(*) FROM auth.users WHERE email LIKE 'setup-${run}-%@bedos-setup-live.invalid';`)==='0');
 }catch{results.push({name:'Local setup fixture cleanup needs review',pass:false});fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/staff-resume-local-cleanup.json',JSON.stringify({fixtures:fixtures.map(({id,email,name})=>({id,email,name}))}));}
 if(installed){try{
  const body=JSON.parse(sql("SELECT json_build_object('body',prosrc) FROM pg_proc WHERE oid='public.bedos_setup_staff_invitation(uuid,uuid,text,boolean)'::regprocedure;")).body;if(body.replace(/\s+/g,'')!==source.split('$function$')[1].replace(/\s+/g,''))throw Error('Function parity changed');
  sql("DROP FUNCTION public.bedos_setup_staff_invitation(uuid,uuid,text,boolean);NOTIFY pgrst,'reload schema';");check('temporary setup function removed',true);
 }catch{results.push({name:'Local setup function cleanup needs review',pass:false});}}
 const report={date:new Date().toISOString(),scope:'Local lab only; actual compiled shared service, Auth/mail and concurrency with injected failures; no credentials, hashes, links or identifiers retained',results};fs.writeFileSync('docs/module-2-evidence/local-staff-resume-integration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(results.some(x=>!x.pass))process.exitCode=1;
}
