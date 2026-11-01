// Approved production smoke checks. No credentials, cookies or record mutations.
import fs from 'node:fs';
import crypto from 'node:crypto';
const origin='https://bedos-construction-platform.vercel.app';
const prefix='absent-catalog-smoke-'+crypto.randomUUID();
const id=crypto.randomUUID(),results=[];
async function request(path,method='GET'){
 const response=await fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:method==='GET'?{}:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})});
 let data=null;try{data=await response.json();}catch{}
 return {status:response.status,data,cache:response.headers.get('cache-control')};
}
function check(name,pass,status){results.push({name,pass:!!pass,...(status?{http_status:status}:{})});if(!pass)throw Error('Production smoke assertion failed');}
try{
 for(const [path,key] of [['/api/public/services','services'],['/api/public/service-categories','categories']]){
  const r=await request(`${path}?q=${prefix}`);
  check(`${key} public API and bounded empty result`,r.status===200&&Array.isArray(r.data?.[key])&&r.data[key].length===0&&r.data.pagination?.total===0&&r.data.pagination.page===1&&r.data.pagination.page_size===25,r.status);
  check(`${key} public response not cacheable`,/no-store/.test(r.cache||''));
 }
 for(const [name,path,status,method] of [
  ['missing public slug','/api/public/services/'+prefix,404,'GET'],
  ['public cannot request drafts','/api/public/services?status=draft',400,'GET'],
  ['excessive public page size','/api/public/services?page_size=101',400,'GET'],
  ['repeated public query','/api/public/services?q=a&q=b',400,'GET'],
  ['protected service list anonymous denial','/api/services',401,'GET'],
  ['protected service detail anonymous denial','/api/services/'+id,401,'GET'],
  ['service creation anonymous denial','/api/services',401,'POST'],
  ['service edit anonymous denial','/api/services/'+id,401,'PATCH'],
  ['category creation anonymous denial','/api/service-categories',401,'POST'],
 ]){const r=await request(path,method);check(name,r.status===status,r.status);}
}catch{results.push({name:'Production catalog anonymous checks stopped',pass:false});}
const report={date:new Date().toISOString(),scope:'Production public/anonymous compatibility checks; no cookies credentials existing-record contents or mutations',results};
fs.writeFileSync('docs/module-3-evidence/production-catalog-anonymous.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:results.length,failed:results.filter(x=>!x.pass).length,results}));
if(results.some(x=>!x.pass))process.exitCode=1;
