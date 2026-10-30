import fs from 'node:fs';
const e={};for(const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*(\w+)\s*=\s*(.*)$/);if(m)e[m[1]]=m[2].trim().replace(/^(['"])(.*)\1$/,'$2');}
const ref=fs.readFileSync('supabase/.temp/project-ref','utf8').trim(),base=`https://${ref}.supabase.co`;
if(e.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!==base)throw Error('Project mismatch');
const headers={apikey:e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,'content-type':'application/json'};
const r=await fetch(base+'/auth/v1/settings',{headers,signal:AbortSignal.timeout(15000)});const settings=await r.json();
const results=[{name:'public Auth requires email confirmation',pass:r.ok&&settings.mailer_autoconfirm===false}];
if(results[0].pass){
 const weak=await fetch(base+'/auth/v1/signup',{method:'POST',headers,body:JSON.stringify({email:`nathaniel.koranteng.antwics2022+bedos-weak-${Date.now()}@gmail.com`,password:'aA1!xyz'}),signal:AbortSignal.timeout(15000)});
 const data=await weak.json();results.push({name:'direct Auth rejects seven-character password',pass:weak.status===422&&data.error_code==='weak_password',status:weak.status,error_code:data.error_code});
}
const report={date:new Date().toISOString(),scope:'Public settings and invalid-password validation only; no valid signup, email, session or real account change intended',results};
fs.writeFileSync('docs/release-evidence/auth-policy-production-negative-tests.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
