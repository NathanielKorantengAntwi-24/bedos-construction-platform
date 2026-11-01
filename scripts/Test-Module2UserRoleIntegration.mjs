// Guarded local Auth/RLS + role/status concurrency; no hosted credentials or API calls.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const container='supabase_db_bedos-supabase-lab';
const inspect=name=>JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8',windowsHide:true}))[0];
const db=inspect(container),auth=inspect('supabase_auth_bedos-supabase-lab');
const env=new Map(auth.Config.Env.map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
if(db.Name!==`/${container}`||!db.Config.Image.includes('supabase/postgres')||!env.get('GOTRUE_DB_DATABASE_URL')?.includes(container)||!env.get('GOTRUE_JWT_SECRET'))throw Error('Local lab guard failed');
const sql=query=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-t','-A','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
function jwt(role){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+1800})).toString('base64url');return`${h}.${p}.`+crypto.createHmac('sha256',env.get('GOTRUE_JWT_SECRET')).update(`${h}.${p}`).digest('base64url');}
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},base='http://127.0.0.1:55321';
const admin=createClient(base,jwt('service_role'),options),userClient=()=>createClient(base,jwt('anon'),options);
const run=crypto.randomUUID(),fixtures=[],results=[];
const serviceId=crypto.randomUUID(),serviceSlug=`role-change-integration-${run}`;
const snapshots="SELECT json_agg(json_build_object('definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl::text) ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN ('public.get_user_role()'::regprocedure,'public.update_own_profile(text,text)'::regprocedure);";
const original=JSON.parse(sql(snapshots));
const functions=[
 {name:'bedos_update_user_status',signature:'uuid,uuid,text,text,text',file:'20261101000000_add_admin_account_status.sql'},
 {name:'bedos_update_user_role',signature:'uuid,uuid,uuid,uuid,text',file:'20261101010000_add_admin_staff_role_changes.sql'},
].map(f=>({...f,source:fs.readFileSync(`supabase/migrations/${f.file}`,'utf8')}));
let installed=false,serviceCreated=false,staffClient;
const check=(name,pass)=>{results.push({name,pass:!!pass});if(!pass)throw Error(name);};
const roleArgs=(actor,staff,destination,expected)=>({p_actor_id:actor.id,p_user_id:staff.id,p_role_id:destination,p_expected_role_id:expected,p_reason:'Local staff role verification'});
const statusArgs=(actor,staff,status,expected)=>({p_actor_id:actor.id,p_user_id:staff.id,p_account_status:status,p_expected_account_status:expected,p_reason:'Local role status compatibility'});
async function fixture(label,role,active=true){
 const email=`role-${run}-${label}@bedos-role-change-live.invalid`,name=`Local role change ${run} ${label}`,password=crypto.randomBytes(24).toString('base64url')+'aA1!';
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name,bedos_staff_onboarding_pending:!active}});
 const f={id:created.data.user?.id,email,name,password};if(f.id)fixtures.push(f);
 check(`${label} exact fixture created`,!created.error&&!!f.id&&created.data.user.email===email);
 const r=await admin.from('roles').select('id').eq('name',role).single();check(`${label} role exists`,!r.error&&!!r.data?.id);f.roleId=r.data.id;
 const p=await admin.from('profiles').update({role_id:f.roleId,account_status:active?'active':'inactive'}).eq('id',f.id).select('id').single();check(`${label} profile configured`,!p.error&&p.data?.id===f.id);return f;
}
try{
 check('new local functions absent',sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('bedos_update_user_status','bedos_update_user_role');")==='0');
 fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/user-role-dependency-snapshot.json',JSON.stringify(original));
 const dependencies=['20261029000000_restrict_role_lookup_to_active_accounts.sql','20261030000000_restrict_legacy_profile_update_to_active_accounts.sql'].map(file=>fs.readFileSync(`supabase/migrations/${file}`,'utf8'));
 const source=[...dependencies,...functions.map(f=>f.source)].map(x=>x.replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'')).join('\n');
 sql(`BEGIN; SET LOCAL lock_timeout='5s'; ${source}\nCOMMIT; NOTIFY pgrst,'reload schema';`);installed=true;
 let ready;
 for(let i=0;i<30;i++){ready=await admin.rpc('bedos_update_user_role',{p_actor_id:crypto.randomUUID(),p_user_id:crypto.randomUUID(),p_role_id:crypto.randomUUID(),p_expected_role_id:crypto.randomUUID(),p_reason:'Readiness'});if(ready.error?.code==='42501')break;await new Promise(r=>setTimeout(r,200));}
 check('role RPC ready with actor denial',ready?.error?.code==='42501');
 const actor=await fixture('actor','administrator'),secondActor=await fixture('second-actor','administrator'),staff=await fixture('staff','content_manager',false);
 const roles=await admin.from('roles').select('id,name').in('name',['finance','sales_customer_service']);check('destination roles resolved',!roles.error&&roles.data?.length===2);
 const finance=roles.data.find(x=>x.name==='finance').id,sales=roles.data.find(x=>x.name==='sales_customer_service').id;
 let r=await admin.rpc('bedos_authorize_staff_invitation',{p_user_id:staff.id,p_invited_by:actor.id,p_approved_role_id:staff.roleId});check('trusted staff invitation authorized',!r.error&&!!r.data);staff.invitationId=r.data;
 r=await admin.rpc('bedos_record_staff_invitation_password_baseline',{p_user_id:staff.id});check('staff password baseline recorded',!r.error&&r.data===staff.invitationId);
 staffClient=userClient();r=await staffClient.auth.signInWithPassword({email:staff.email,password:staff.password});check('local provider setup session',!r.error&&r.data.user?.id===staff.id);
 staff.password=crypto.randomBytes(24).toString('base64url')+'bB2!';r=await staffClient.auth.updateUser({password:staff.password});check('staff changes own password after baseline',!r.error&&r.data.user?.id===staff.id);
 r=await admin.rpc('bedos_activate_staff_invitation',{p_user_id:staff.id,p_actor_id:actor.id});check('trusted staff onboarding activated',!r.error&&r.data===staff.invitationId);
 const token=(await staffClient.auth.getSession()).data.session.access_token;
 const created=await admin.from('services').insert({id:serviceId,name:'Local role access fixture',slug:serviceSlug,status:'draft'});serviceCreated=!created.error;check('dedicated draft service created',serviceCreated);
 r=await staffClient.from('services').select('id').eq('id',serviceId);check('content staff session sees draft',!r.error&&r.data?.length===1);
 r=await staffClient.rpc('bedos_update_user_role',roleArgs(actor,staff,finance,staff.roleId));check('staff cannot forge administrator actor',r.error?.code==='42501');
 r=await admin.rpc('bedos_update_user_role',roleArgs(actor,staff,finance,staff.roleId));check('administrator changes staff to finance',!r.error&&r.data?.role?.id===finance);
 check('existing access token retained',(await staffClient.auth.getSession()).data.session?.access_token===token);
 r=await staffClient.rpc('get_user_role');check('same real session now resolves finance',!r.error&&r.data==='finance');
 r=await staffClient.from('profiles').select('role_id').eq('id',staff.id).single();check('same session profile reflects new role',!r.error&&r.data?.role_id===finance);
 r=await staffClient.from('services').select('id').eq('id',serviceId);check('same real session loses content draft access',!r.error&&r.data?.length===0);
 r=await admin.rpc('bedos_update_user_status',statusArgs(actor,staff,'suspended','active'));check('updated proof supports staff suspension',!r.error&&r.data?.account_status==='suspended');
 r=await admin.rpc('bedos_update_user_role',roleArgs(actor,staff,sales,finance));check('suspended role edit rejected',r.error?.code==='P0001');
 r=await admin.rpc('bedos_update_user_status',statusArgs(actor,staff,'active','suspended'));check('updated proof supports staff restoration',!r.error&&r.data?.account_status==='active');
 r=await admin.rpc('bedos_update_user_role',roleArgs(actor,staff,staff.roleId,finance));check('content staff role restored',!r.error&&r.data?.role?.id===staff.roleId);
 r=await staffClient.from('services').select('id').eq('id',serviceId);check('same real session regains draft access',!r.error&&r.data?.length===1);
 const race=await Promise.all([[actor,finance],[secondActor,sales]].map(([a,to])=>admin.rpc('bedos_update_user_role',roleArgs(a,staff,to,staff.roleId))));
 check('concurrent role requests have one winner',race.filter(x=>!x.error).length===1&&race.filter(x=>x.error?.code==='P0001').length===1);
 const winner=race.find(x=>!x.error).data.role.id;
 let audits=await admin.from('audit_logs').select('actor_id,metadata').eq('entity_id',staff.id).eq('action','staff_role_changed');check('role conflict loser has no extra audit',!audits.error&&audits.data?.length===3);
 const crossRace=await Promise.all([admin.rpc('bedos_update_user_status',statusArgs(actor,staff,'suspended','active')),admin.rpc('bedos_update_user_role',roleArgs(secondActor,staff,staff.roleId,winner))]);
 check('role versus suspension has valid serial outcome',!crossRace[0].error&&(!crossRace[1].error||crossRace[1].error.code==='P0001'));
 const profile=await admin.from('profiles').select('role_id,account_status').eq('id',staff.id).single(),proof=await admin.from('staff_invitations').select('approved_role_id,status').eq('user_id',staff.id).single();
 check('cross-race profile and invitation remain consistent',!profile.error&&!proof.error&&profile.data.account_status==='suspended'&&profile.data.role_id===proof.data.approved_role_id&&proof.data.status==='activated');
 audits=await admin.from('audit_logs').select('actor_id,metadata').eq('entity_id',staff.id).eq('action','staff_role_changed');
 check('cross-race audit count matches committed changes',!audits.error&&audits.data?.length===(crossRace[1].error?3:4));
 check('all role audit actors and reasons correct',audits.data.every(a=>[actor.id,secondActor.id].includes(a.actor_id)&&a.metadata.reason==='Local staff role verification'));
 const approved=await admin.from('audit_logs').select('metadata').eq('entity_id',staff.id).eq('action','staff_invitation_authorized');check('original invitation approval history retained',!approved.error&&approved.data?.length===1&&approved.data[0].metadata.approved_role_id===staff.roleId);
}catch(error){results.push({name:'Local role integration stopped',pass:false,stage:error.message.startsWith('Command failed')?'local database command':error.message});}
finally{
 try{
  if(staffClient){const out=await staffClient.auth.signOut({scope:'local'});check('local staff session signed out',!out.error);}
  for(const f of fixtures){const u=await admin.auth.admin.getUserById(f.id);if(!/^[a-f0-9-]{36}$/.test(f.id)||u.error||u.data.user?.email!==f.email||u.data.user.user_metadata?.full_name!==f.name)throw Error('Local exact identity guard failed');}
  const ids=fixtures.map(f=>`'${f.id}'`).join(',');if(ids)sql(`BEGIN; DELETE FROM public.staff_invitations WHERE user_id IN (${ids}); DELETE FROM public.audit_logs WHERE actor_id IN (${ids}) AND entity_id IN (${ids}); COMMIT;`);
  if(serviceCreated){const d=await admin.from('services').delete().eq('id',serviceId).eq('slug',serviceSlug).select('id');check('exact draft service removed',!d.error&&d.data?.length===1);}
  for(const f of fixtures){const d=await admin.auth.admin.deleteUser(f.id);check('exact local role fixture removed',!d.error);}
  check('local role integration identities absent',sql(`SELECT count(*) FROM auth.users WHERE email LIKE 'role-${run}-%@bedos-role-change-live.invalid';`)==='0');
 }catch{results.push({name:'Local role fixture cleanup needs review',pass:false});fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/user-role-local-cleanup.json',JSON.stringify({fixtures:fixtures.map(({id,email,name})=>({id,email,name})),serviceId,serviceSlug}));}
 if(installed){let stage='function parity';try{
  for(const f of functions){const actual=JSON.parse(sql(`SELECT json_build_object('body',prosrc) FROM pg_proc WHERE oid='public.${f.name}(${f.signature})'::regprocedure;`)).body;if(actual.replace(/\s+/g,'')!==f.source.split('$function$')[1].replace(/\s+/g,''))throw Error('Local function changed');}
  stage='restore transaction';sql(`BEGIN; SET LOCAL lock_timeout='5s'; ${functions.map(f=>`DROP FUNCTION public.${f.name}(${f.signature});`).join('\n')} ${original.map(x=>x.definition.trimEnd()+';').join('\n')} COMMIT; NOTIFY pgrst,'reload schema';`);
  check('original dependencies and ACLs restored',JSON.stringify(JSON.parse(sql(snapshots)))===JSON.stringify(original));
  check('temporary local functions removed',sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('bedos_update_user_status','bedos_update_user_role');")==='0');
 }catch{results.push({name:'Local role function restoration needs review',pass:false,stage});}}
 const report={date:new Date().toISOString(),scope:'Local lab only; confirmed fixtures are setup, not email flow evidence; actual provider/session RLS and role/status races; fixtures removed and original helper definitions restored',results};
 fs.writeFileSync('docs/module-2-evidence/local-user-role-integration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(results.some(x=>!x.pass))process.exitCode=1;
}
