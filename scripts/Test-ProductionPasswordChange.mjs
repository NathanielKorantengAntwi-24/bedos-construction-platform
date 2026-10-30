import fs from 'node:fs';
import crypto from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const env={};for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=line.match(/^\s*(\w+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');}
const ref=fs.readFileSync('supabase/.temp/project-ref','utf8').trim();const url=`https://${ref}.supabase.co`,origin='https://bedos-construction-platform.vercel.app';
if(env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!==url)throw Error('Project mismatch');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(url,env.SUPABASE_SERVICE_ROLE_KEY,options),client=createClient(url,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,options);
const results=[];let id;const email=`nathaniel.koranteng.antwics2022+bedos-password-regression-${Date.now()}@gmail.com`;
const oldPassword=crypto.randomBytes(24).toString('base64url')+'aA1!',newPassword=crypto.randomBytes(24).toString('base64url')+'bB2!';
const cookies=new Map();
function check(name,ok){results.push({name,pass:!!ok});if(!ok)throw Error(name);}
async function api(path,method='GET',body){const r=await fetch(origin+path,{method,headers:{'content-type':'application/json',cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});for(const c of r.headers.getSetCookie()){const p=c.split(';')[0],i=p.indexOf('=');if(p.slice(i+1))cookies.set(p.slice(0,i),p.slice(i+1));else cookies.delete(p.slice(0,i));}let data={};try{data=await r.json();}catch{}return{status:r.status,data};}
try{
 const e2e=JSON.parse(fs.readFileSync('docs/release-evidence/customer-confirmation-production-e2e.json','utf8').replace(/^\uFEFF/,''));
 check('saved confirmation E2E contains five passing checks',e2e.results?.length===5&&e2e.results.every(r=>r.pass));
 const confirmed=await admin.auth.admin.getUserById(e2e.userId);
 check('production confirms expected E2E customer email',!confirmed.error&&confirmed.data.user?.email===e2e.email&&!!confirmed.data.user.email_confirmed_at);
 // Confirmed admin-created fixture is setup ONLY; public confirmation was tested above.
 const created=await admin.auth.admin.createUser({email,password:oldPassword,email_confirm:true,user_metadata:{full_name:'Disposable password regression'}});
 id=created.data.user?.id;check('dedicated credential fixture created',!created.error&&!!id&&created.data.user.email===email);
 let r=await client.auth.signInWithPassword({email,password:oldPassword});check('original fixture password authenticates',!r.error&&r.data.user?.id===id);
 r=await client.auth.updateUser({password:newPassword});check('authenticated password change succeeds',!r.error&&r.data.user?.id===id);
 r=await client.auth.signInWithPassword({email,password:oldPassword});check('previous password rejected by Auth',r.error?.code==='invalid_credentials'&&!r.data.session);
 let b=await api('/api/auth/login','POST',{email,password:oldPassword});check('previous password rejected by backend',b.status===401);
 r=await client.auth.signInWithPassword({email,password:newPassword});check('new password accepted by Auth',!r.error&&r.data.user?.id===id);
 b=await api('/api/auth/login','POST',{email,password:newPassword});check('new password accepted by backend',b.status===200&&b.data.user?.id===id);
 b=await api('/api/auth/me');check('new backend session has expected customer identity',b.status===200&&b.data.user?.id===id&&b.data.role?.name==='customer');
}catch(e){results.push({name:'credential verification stopped',pass:false,reason:e.message});}
finally{
 try{await api('/api/auth/logout','POST');await client.auth.signOut();}catch{}
 if(id){try{const u=await admin.auth.admin.getUserById(id);if(u.error||u.data.user?.email!==email)throw Error('Fixture guard failed');const removed=await admin.auth.admin.deleteUser(id);check('only this disposable credential fixture removed',!removed.error);}catch{results.push({name:'fixture cleanup',pass:false,userId:id});}}
 const report={date:new Date().toISOString(),scope:'Read-only confirmation of user-run E2E and disposable confirmed credential fixture only. Confirms old password rejection after authenticated password change. No passwords/tokens stored; original customer/admin accounts untouched.',results};fs.writeFileSync('docs/release-evidence/password-change-production-regression.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
}
