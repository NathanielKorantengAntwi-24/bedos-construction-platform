// Release-only credential-free checks. No successful mutation or private record lookup.
import fs from 'node:fs';import crypto from 'node:crypto';
const origin='https://bedos-construction-platform.vercel.app',id=crypto.randomUUID(),results=[];
async function check(name,path,method='GET',status=401){const r=await fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(20000),...(method!=='GET'?{body:'{}',headers:{'Content-Type':'application/json'}}:{})});const pass=r.status===status&&/no-store/.test(r.headers.get('cache-control')||'');results.push({name,pass,http_status:r.status});await r.body?.cancel();if(!pass)throw Error('Viewing smoke verification stopped');}
try{
 await check('Anonymous root viewing list denied','/api/viewing-requests');
 const path='/api/properties/'+id+'/viewing-requests';
 await check('Anonymous staff property list denied',path);await check('Anonymous viewing submission denied',path,'POST');
 await check('Anonymous viewing detail denied',path+'/'+id);await check('Anonymous viewing edit denied',path+'/'+id,'PATCH');await check('Anonymous viewing deletion denied',path+'/'+id+'?expected_version=1','DELETE');
 await check('Anonymous viewing event queue denied','/api/viewing-requests/notification-events');await check('Anonymous event retry denied','/api/viewing-requests/notification-events/'+id+'/retry','POST');
 await check('Existing public property catalog compatible','/api/properties?limit=1','GET',200);await check('Existing guarded missing property image hidden','/api/properties/'+id+'/images/'+id+'/file','GET',404);
}catch{results.push({name:'Viewing production smoke verification stopped',pass:false});}
fs.writeFileSync('docs/module-6-evidence/production-viewing-anonymous.json',JSON.stringify({date:new Date().toISOString(),scope:'Credential-free production compatibility checks only; no successful writes or private record contents',results},null,2)+'\n');console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.pass).length,results}));if(results.some(r=>!r.pass))process.exitCode=1;
