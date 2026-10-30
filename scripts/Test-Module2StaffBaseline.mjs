import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
const source=JSON.parse(execFileSync('docker',['inspect','supabase_auth_bedos-supabase-lab'],{encoding:'utf8',windowsHide:true}))[0];
const env=new Map(source.Config.Env.map(e=>{const n=e.indexOf('=');return[e.slice(0,n),e.slice(n+1)];}));
if(!env.get('GOTRUE_DB_DATABASE_URL')?.includes('supabase_db_bedos-supabase-lab')||env.get('GOTRUE_SMTP_HOST')!=='supabase_inbucket_bedos-supabase-lab')throw Error('Lab identity guard failed');
const jwt=role=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600})).toString('base64url');return `${h}.${p}.`+crypto.createHmac('sha256',env.get('GOTRUE_JWT_SECRET')).update(`${h}.${p}`).digest('base64url');};
const base='http://127.0.0.1:55321',opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(base,jwt('service_role'),opts),anon=()=>createClient(base,jwt('anon'),opts);
const run=Date.now(),fixtures=[],results=[];const extended=process.argv.includes('--extended');let actor,role;
const check=(name,ok)=>{results.push({name,pass:!!ok});if(!ok)throw Error(name);};
async function create(label,roleName){
 const email=`bedos-m2-${run}-${label}@bedos-m2-test.invalid`,name=`Bedos M2 audit ${run} ${label}`;
 const r=await admin.auth.admin.createUser({email,email_confirm:label==='actor',password:label==='actor'?crypto.randomBytes(24).toString('base64url'):undefined,user_metadata:{full_name:name,bedos_staff_onboarding_pending:label!=='actor'}});
 check(label+' synthetic identity created',!r.error&&!!r.data.user?.id);const f={id:r.data.user.id,email,name};fixtures.push(f);
 const roles=await admin.from('roles').select('id,name').eq('name',roleName).single();check(label+' expected role exists',!roles.error&&!!roles.data?.id);
 const p=await admin.from('profiles').update({role_id:roles.data.id,account_status:label==='actor'?'active':'inactive'}).eq('id',f.id).select('id').single();check(label+' fixture role/status configured',!p.error&&p.data?.id===f.id);f.roleId=roles.data.id;return f;
}
async function invite(f){
 let r=await admin.rpc('bedos_authorize_staff_invitation',{p_user_id:f.id,p_invited_by:actor.id,p_approved_role_id:f.roleId});check('trusted invitation authorization',!r.error&&!!r.data);f.invitationId=r.data;
 r=await admin.auth.admin.inviteUserByEmail(f.email);check('Auth invitation accepted for same identity',!r.error&&r.data.user?.id===f.id);
 r=await admin.rpc('bedos_record_staff_invitation_password_baseline',{p_user_id:f.id});check('post-invitation password baseline recorded',!r.error&&r.data===f.invitationId);
}
async function acceptEmail(f,type='invite'){
 let html='';for(let i=0;i<15;i++){const r=await fetch(`http://127.0.0.1:55324/view/latest.html?query=${encodeURIComponent('to:'+f.email)}`);if(r.ok){html=await r.text();break;}await new Promise(r=>setTimeout(r,500));}
 const urls=[...html.matchAll(/https?:\/\/[^\s<>"']+/g)].map(m=>new URL(m[0].replaceAll('&amp;','&')));
 const link=urls.find(u=>u.origin===base&&u.pathname==='/auth/v1/verify'&&u.searchParams.get('type')===type);check(`local ${type} email has guarded Auth link`,!!link);
 const r=await fetch(link,{redirect:'manual'});const location=new URL(r.headers.get('location')||'http://invalid.invalid');const hash=new URLSearchParams(location.hash.slice(1));
 check(`local ${type} verification returned a session`,r.status===303&&!!hash.get('access_token')&&!!hash.get('refresh_token'));
 check(`${type} lands on trusted home Auth bridge`,location.origin==='http://127.0.0.1:3000'&&location.pathname==='/');
 f.client=createClient(base,jwt('anon'),{auth:{...opts.auth,flowType:'pkce'}});const s=await f.client.auth.setSession({access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token')});check('explicit session works with PKCE client for expected staff',!s.error&&s.data.user?.id===f.id&&!!s.data.user.email_confirmed_at);
}
try{
 actor=await create('actor','administrator');role='content_manager';
 const a=await create('normal',role);await invite(a);
 let r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:a.id,p_actor_id:actor.id});check('activation denied before email setup',r.error?.code==='22023');
 await acceptEmail(a);
 r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:a.id,p_actor_id:actor.id});check('activation denied before actual password change',r.error?.code==='22023');
 r=await a.client.auth.updateUser({password:crypto.randomBytes(24).toString('base64url')+'aA1!'});check('invited staff sets own password',!r.error&&r.data.user?.id===a.id);
 r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:a.id,p_actor_id:actor.id});check('activation succeeds after trusted onboarding',!r.error&&r.data===a.invitationId);
 r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:a.id,p_actor_id:actor.id});check('duplicate activation rejected',r.error?.code==='22023');
 const b=await create('retry',role);await invite(b);await new Promise(r=>setTimeout(r,1200));
 r=await admin.rpc('bedos_prepare_staff_invitation_retry',{p_user_id:b.id,p_actor_id:actor.id});check('unconfirmed retry selects invitation method',!r.error&&r.data?.method==='invite');const attempt=r.data?.attempt_number;
 r=await admin.auth.admin.inviteUserByEmail(b.email,{redirectTo:'http://127.0.0.1:3000/'});check('retried Auth invitation preserves identity',!r.error&&r.data.user?.id===b.id);
 r=await admin.rpc('bedos_finish_staff_invitation_retry',{p_user_id:b.id,p_actor_id:actor.id,p_attempt_number:attempt,p_accepted:true});check('retry outcome audited',!r.error&&r.data===b.invitationId);
 await acceptEmail(b);
 r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:b.id,p_actor_id:actor.id});check('resent invitation alone cannot satisfy password-change proof',r.error?.code==='22023');
 if(extended){
  const c=await create('confirmed-recovery',role);await invite(c);await acceptEmail(c);
  await new Promise(resolve=>setTimeout(resolve,1200));
  r=await admin.rpc('bedos_prepare_staff_invitation_retry',{p_user_id:c.id,p_actor_id:actor.id});check('confirmed pending staff selects recovery',!r.error&&r.data?.method==='recovery');const recoveryAttempt=r.data?.attempt_number;
  r=await admin.auth.resetPasswordForEmail(c.email,{redirectTo:'http://127.0.0.1:3000/'});check('server-initiated recovery email accepted',!r.error);
  r=await admin.rpc('bedos_finish_staff_invitation_retry',{p_user_id:c.id,p_actor_id:actor.id,p_attempt_number:recoveryAttempt,p_accepted:true});check('recovery dispatch result audited',!r.error&&r.data===c.invitationId);
  r=await admin.rpc('bedos_prepare_staff_invitation_retry',{p_user_id:c.id,p_actor_id:actor.id});check('immediate retry blocked by cooldown',r.error?.code==='P0001');
  r=await admin.rpc('bedos_finish_staff_invitation_retry',{p_user_id:c.id,p_actor_id:actor.id,p_attempt_number:recoveryAttempt,p_accepted:true});check('duplicate retry completion rejected',r.error?.code==='22023');
  await acceptEmail(c,'recovery');
  r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:c.id,p_actor_id:actor.id});check('recovery link alone does not prove password setup',r.error?.code==='22023');
  r=await c.client.auth.updateUser({password:crypto.randomBytes(24).toString('base64url')+'cC3!'});check('recovered staff sets own password',!r.error&&r.data.user?.id===c.id);
  r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:c.id,p_actor_id:actor.id});check('recovered staff activation succeeds after password setup',!r.error&&r.data===c.invitationId);

  const d=await create('revocation',role);await invite(d);
  const rpcCases=[
   ['bedos_activate_staff_invitation',{p_user_id:d.id,p_actor_id:actor.id}],
   ['bedos_revoke_staff_invitation',{p_user_id:d.id,p_actor_id:actor.id}],
   ['bedos_prepare_staff_invitation_retry',{p_user_id:d.id,p_actor_id:actor.id}],
   ['bedos_finish_staff_invitation_retry',{p_user_id:d.id,p_actor_id:actor.id,p_attempt_number:1,p_accepted:false}],
   ['bedos_record_staff_invitation_password_baseline',{p_user_id:d.id}],
   ['bedos_authorize_staff_invitation',{p_user_id:d.id,p_invited_by:actor.id,p_approved_role_id:d.roleId}],
  ];
  for(const [name,args] of rpcCases){
   for(const [label,client] of [['anonymous',anon()],['ordinary staff',c.client]]){
    r=await client.rpc(name,args);check(`${label} cannot invoke ${name} with forged administrator identity`,['42501','PGRST202'].includes(r.error?.code));
   }
  }
  r=await admin.rpc('bedos_revoke_staff_invitation',{p_user_id:d.id,p_actor_id:c.id});check('ordinary staff denied by database actor-permission check',r.error?.code==='42501');
  r=await admin.rpc('bedos_authorize_staff_invitation',{p_user_id:d.id,p_invited_by:actor.id,p_approved_role_id:actor.roleId});check('administrator role cannot be assigned through staff invitations',r.error?.code==='22023');
  await admin.from('profiles').update({account_status:'suspended'}).eq('id',actor.id);
  r=await admin.rpc('bedos_revoke_staff_invitation',{p_user_id:d.id,p_actor_id:actor.id});check('suspended administrator denied in database',r.error?.code==='42501');
  await admin.from('profiles').update({account_status:'active'}).eq('id',actor.id);
  r=await admin.rpc('bedos_revoke_staff_invitation',{p_user_id:d.id,p_actor_id:actor.id});check('pending invitation revoked',!r.error&&r.data===d.invitationId);
  r=await admin.from('profiles').select('account_status').eq('id',d.id).single();check('revoked staff remains inactive',!r.error&&r.data?.account_status==='inactive');
  r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:d.id,p_actor_id:actor.id});check('revoked invitation cannot activate',r.error?.code==='22023');
  r=await admin.rpc('bedos_prepare_staff_invitation_retry',{p_user_id:d.id,p_actor_id:actor.id});check('revoked invitation cannot retry',r.error?.code==='22023');
  r=await admin.rpc('bedos_revoke_staff_invitation',{p_user_id:d.id,p_actor_id:actor.id});check('duplicate revocation rejected',r.error?.code==='22023');

  const e=await create('concurrent-retry',role);await invite(e);
  const competing=await Promise.all([1,2].map(()=>admin.rpc('bedos_prepare_staff_invitation_retry',{p_user_id:e.id,p_actor_id:actor.id})));
  const winner=competing.find(result=>!result.error);check('concurrent retries produce one winner and one cooldown rejection',competing.filter(result=>!result.error).length===1&&competing.filter(result=>result.error?.code==='P0001').length===1);
  r=await admin.rpc('bedos_finish_staff_invitation_retry',{p_user_id:e.id,p_actor_id:actor.id,p_attempt_number:winner?.data?.attempt_number,p_accepted:false});check('failed dispatch result recorded without activation',!r.error&&r.data===e.invitationId);
  r=await admin.from('profiles').select('account_status').eq('id',e.id).single();check('failed dispatch leaves account inactive',!r.error&&r.data?.account_status==='inactive');
  const audit=await admin.from('audit_logs').select('action,entity_id').eq('actor_id',actor.id).in('entity_id',[a.id,b.id,c.id,d.id,e.id]);check('synthetic audit records readable by trusted backend',!audit.error);
  for(const [target,action] of [[a,'staff_invitation_activated'],[b,'staff_invitation_retry_accepted'],[c,'staff_invitation_activated'],[d,'staff_invitation_revoked'],[e,'staff_invitation_retry_requested'],[e,'staff_invitation_retry_failed']]){
   check(`exactly one ${action} for intended target`,audit.data.filter(row=>row.entity_id===target.id&&row.action===action).length===1);
  }

  const f=await create('audit-rollback',role);await invite(f);
  if(![f.id,actor.id].every(id=>/^[-0-9a-f]{36}$/.test(id)))throw Error('Invalid audit fixture IDs');
  const rollbackSql=`BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s';
   CREATE TEMP TABLE audit_test_context(value integer);
   CREATE FUNCTION pg_temp.reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514'; END; $fn$;
   CREATE TRIGGER bedos_m2_audit_test_${run} BEFORE INSERT ON public.audit_logs FOR EACH ROW
   WHEN (NEW.actor_id='${actor.id}'::uuid AND NEW.entity_id='${f.id}'::uuid AND NEW.action='staff_invitation_revoked') EXECUTE FUNCTION pg_temp.reject_test_audit();
   DO $test$ BEGIN
    BEGIN PERFORM public.bedos_revoke_staff_invitation('${f.id}'::uuid,'${actor.id}'::uuid); RAISE EXCEPTION 'Expected audit failure did not occur';
    EXCEPTION WHEN check_violation THEN NULL; END;
    IF NOT EXISTS(SELECT 1 FROM public.staff_invitations WHERE user_id='${f.id}'::uuid AND status='pending')
       OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='${f.id}'::uuid AND account_status='inactive') THEN RAISE EXCEPTION 'Audit failure did not roll back transition'; END IF;
   END; $test$; ROLLBACK;`;
  execFileSync('docker',['exec','-i','supabase_db_bedos-supabase-lab','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:rollbackSql,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
  check('failed audit insert rolls back invitation revocation',true);

  const g=await create('activation-revocation-race',role);await invite(g);await acceptEmail(g);
  r=await g.client.auth.updateUser({password:crypto.randomBytes(24).toString('base64url')+'dD4!'});check('race fixture password setup succeeds',!r.error);
  const race=await Promise.all([
   admin.rpc('bedos_activate_staff_invitation',{p_user_id:g.id,p_actor_id:actor.id}),
   admin.rpc('bedos_revoke_staff_invitation',{p_user_id:g.id,p_actor_id:actor.id}),
  ]);
  check('activation versus revocation has exactly one winner',race.filter(result=>!result.error).length===1&&race.filter(result=>result.error?.code==='22023').length===1);
  const invitationState=await admin.from('staff_invitations').select('status').eq('user_id',g.id).single();
  const profileState=await admin.from('profiles').select('account_status').eq('id',g.id).single();
  check('racing final invitation/profile state is consistent',!invitationState.error&&!profileState.error&&((invitationState.data.status==='activated'&&profileState.data.account_status==='active')||(invitationState.data.status==='revoked'&&profileState.data.account_status==='inactive')));
 }
}catch(e){results.push({name:'baseline stopped',pass:false,reason:e.message});}
finally{
 try{
  for(const f of fixtures){if(f.client)try{await f.client.auth.signOut({scope:'local'});}catch{}const u=await admin.auth.admin.getUserById(f.id);if(u.error||u.data.user?.email!==f.email||u.data.user?.user_metadata?.full_name!==f.name)throw Error('Cleanup identity guard failed');}
  if(fixtures.length){
   if(fixtures.some(f=>!/^[-0-9a-f]{36}$/.test(f.id)))throw Error('Invalid fixture ID');
   const ids=fixtures.map(f=>`'${f.id}'::uuid`).join(',');
   const sql=`BEGIN; DELETE FROM public.staff_invitations WHERE user_id IN (${ids}); DELETE FROM public.audit_logs WHERE actor_id IN (${ids}) AND entity_id IN (${ids}); COMMIT;`;
   execFileSync('docker',['exec','-i','supabase_db_bedos-supabase-lab','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
   for(const f of [...fixtures].reverse()){const d=await admin.auth.admin.deleteUser(f.id);if(d.error)throw Error('Fixture removal failed');}
  }
  results.push({name:'only synthetic local fixtures removed',pass:true});
 }catch{results.push({name:'local fixture cleanup requires review',pass:false,fixtureIds:fixtures.map(f=>f.id)});}
 const report={date:new Date().toISOString(),scope:'Local staff SQL/Auth/SMTP integration with explicit PKCE-client session adoption. Next.js redirect/fragment wiring is unit-tested separately. No production calls or persistent schema changes. Passwords, hashes, links and tokens excluded.',results};fs.writeFileSync(`docs/module-2-evidence/${extended?'local-staff-recovery-integration':'local-staff-lifecycle-baseline'}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
}
