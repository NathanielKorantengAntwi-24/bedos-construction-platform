import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {GoTrueClient, GoTrueAdminApi} from '@supabase/auth-js';
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true});
const source=JSON.parse(docker(['inspect','supabase_auth_bedos-supabase-lab']))[0];
const env=new Map(source.Config.Env.map(e=>{const i=e.indexOf('=');return [e.slice(0,i),e.slice(i+1)];}));
if(!env.get('GOTRUE_DB_DATABASE_URL')?.includes('supabase_db_bedos-supabase-lab')||env.get('GOTRUE_SMTP_HOST')!=='supabase_inbucket_bedos-supabase-lab')throw Error('Local database/SMTP identity guard failed');
const network=Object.keys(source.NetworkSettings.Networks).find(n=>n.includes('bedos-supabase-lab'));
if(!network||!env.get('GOTRUE_JWT_SECRET'))throw Error('Local network/signing configuration unavailable');
const base='http://127.0.0.1:55326', callback='http://127.0.0.1:3101/auth/callback';
env.set('GOTRUE_MAILER_AUTOCONFIRM','false');env.set('GOTRUE_PASSWORD_MIN_LENGTH','8');
env.set('API_EXTERNAL_URL',base);env.set('GOTRUE_SITE_URL','http://127.0.0.1:3101');env.set('GOTRUE_URI_ALLOW_LIST',callback);
// Standalone Auth is not behind the lab gateway's /auth/v1 prefix.
env.set('GOTRUE_MAILER_URLPATHS_CONFIRMATION','/verify');
const run=Date.now().toString(), name='bedos-auth-policy-test-'+run;
const envFile=path.resolve('.next','auth-policy-env-'+run);
fs.writeFileSync(envFile,[...env].map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{flag:'wx'});
const jwt=(role)=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const p=Buffer.from(JSON.stringify({role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300})).toString('base64url');return `${h}.${p}.`+crypto.createHmac('sha256',env.get('GOTRUE_JWT_SECRET')).update(`${h}.${p}`).digest('base64url');};
const store=new Map();const auth=new GoTrueClient({url:base,headers:{Authorization:'Bearer '+jwt('anon')},flowType:'pkce',persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,v);},removeItem:k=>{store.delete(k);}}});
const admin=new GoTrueAdminApi({url:base,headers:{Authorization:'Bearer '+jwt('service_role')}});
const mailbox='bedos-confirm-'+run,email=mailbox+'@bedos-confirm-test.invalid';
const password=crypto.randomBytes(24).toString('base64url')+'aA1!';
const results=[];let userId,createdContainer=false;
function check(name,ok){results.push({name,pass:!!ok});if(!ok)throw Error(name);}
try{
 docker(['run','--detach','--name',name,'--network',network,'-p','127.0.0.1:55326:9999','--env-file',envFile,source.Config.Image]);createdContainer=true;
 let ready=false;for(let i=0;i<30;i++){try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});ready=r.ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
 check('isolated Auth service ready',ready);
 let r=await auth.signUp({email,password:'aA1!xyz',options:{emailRedirectTo:callback}});
 if(r.data.user?.id)userId=r.data.user.id;
 check('seven-character password rejected',r.error?.code==='weak_password'&&!r.data.user);
 r=await auth.signUp({email,password,options:{emailRedirectTo:callback,data:{full_name:'Synthetic confirmation policy test'}}});
 userId=r.data.user?.id;
 check('signup creates unconfirmed account without session',!r.error&&!!userId&&!r.data.session&&!r.data.user.email_confirmed_at);
 r=await auth.signInWithPassword({email,password});
 check('login denied before email confirmation',r.error?.code==='email_not_confirmed'&&!r.data.session);
 let message;
 for(let i=0;i<20;i++){
  const mail=await fetch(`http://127.0.0.1:55324/view/latest.html?query=${encodeURIComponent('to:'+email)}`);
  if(mail.ok){message={body:{html:await mail.text()}};break;}
  await new Promise(r=>setTimeout(r,1000));
 }
 check('confirmation email delivered to local test inbox',!!message);
 const content=message.body?.html||message.body?.text||'';
 const links=[...content.matchAll(/https?:\/\/[^\s<>"']+/g)].map(m=>m[0].replaceAll('&amp;','&'));
 const verification=links.map(l=>{try{return new URL(l);}catch{return null;}}).find(u=>u?.origin===base&&u.pathname==='/verify');
 check('email contains isolated verification link',!!verification);
 const verified=await fetch(verification,{redirect:'manual',signal:AbortSignal.timeout(10000)});
 const destination=new URL(verified.headers.get('location')||'http://invalid.invalid');
 check('email verification redirects to trusted callback with code',verified.status===303&&destination.origin==='http://127.0.0.1:3101'&&destination.pathname==='/auth/callback'&&!!destination.searchParams.get('code'));
 r=await auth.exchangeCodeForSession(destination.searchParams.get('code'));
 check('PKCE callback exchange establishes correct confirmed session',!r.error&&r.data.user?.id===userId&&!!r.data.user.email_confirmed_at&&!!r.data.session);
 await auth.signOut({scope:'local'});
 r=await auth.signInWithPassword({email,password});
 check('password login succeeds after email confirmation',!r.error&&r.data.user?.id===userId&&!!r.data.session);
 await auth.signOut({scope:'local'});
}catch(e){results.push({name:'integration stopped',pass:false,reason:e.message});}
finally{
 if(userId){try{const u=await admin.getUserById(userId);if(u.error||u.data.user?.email!==email)throw Error('Fixture identity changed');const d=await admin.deleteUser(userId);check('local synthetic account removed',!d.error);}catch{results.push({name:'local fixture cleanup',pass:false});}}
 if(createdContainer){try{docker(['rm','-f',name]);}catch{results.push({name:'temporary local Auth container cleanup',pass:false});}}
 if(envFile.startsWith(path.resolve('.next')+path.sep)&&fs.existsSync(envFile))fs.unlinkSync(envFile);
 const report={date:new Date().toISOString(),scope:'Local isolated Auth container on lab database and local SMTP only; no production requests. Passwords/links/tokens are not persisted. Existing lab Auth settings unchanged.',results};
 fs.writeFileSync('docs/release-evidence/auth-confirmation-local-tests.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
}
