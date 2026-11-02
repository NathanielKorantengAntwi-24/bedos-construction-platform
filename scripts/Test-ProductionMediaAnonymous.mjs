// Release smoke checks only. No credentials, existing record contents or successful writes.
import fs from 'node:fs';
import crypto from 'node:crypto';
const origin='https://bedos-construction-platform.vercel.app',property=crypto.randomUUID(),child=crypto.randomUUID(),results=[];
async function check(name,path,status,method='GET') {
  const response=await fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:method==='GET'?{}:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})});
  const pass=response.status===status&&/no-store/.test(response.headers.get('cache-control')||'');
  results.push({name,pass,http_status:response.status});await response.body?.cancel();if(!pass)throw Error('Production media smoke check failed');
}
try {
  for(const kind of ['images','floor-plans','features','amenities']) {
    await check(kind+' missing public parent',`/api/properties/${property}/${kind}`,404);
    for(const [method,suffix]of [['POST',''],['PATCH','/'+child],['DELETE','/'+child]])await check(kind+' anonymous '+method+' denied',`/api/properties/${property}/${kind}${suffix}`,401,method);
  }
  for(const kind of ['images','floor-plans'])await check(kind+' missing file hidden',`/api/properties/${property}/${kind}/${child}/file`,404);
  await check('invalid parent ID rejected','/api/properties/invalid/images',400);
  await check('oversized page rejected',`/api/properties/${property}/images?limit=101`,400);
  await check('repeated pagination rejected',`/api/properties/${property}/features?page=1&page=2`,400);
  await check('recovery ledger anonymous denial','/api/property-media/operations',401);
  await check('recovery retry anonymous denial',`/api/property-media/operations/${child}/retry`,401,'POST');
}catch{results.push({name:'Production media anonymous verification stopped',pass:false});}
const report={date:new Date().toISOString(),scope:'Production anonymous compatibility checks only; no credentials, real record contents or successful mutations',results};
fs.writeFileSync('docs/module-5-evidence/production-media-anonymous.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:results.length,failed:results.filter(x=>!x.pass).length,results}));
if(results.some(x=>!x.pass))process.exitCode=1;
