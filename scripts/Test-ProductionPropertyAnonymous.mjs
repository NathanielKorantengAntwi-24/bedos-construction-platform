// No credentials, cookies, existing record contents or mutations.
import fs from 'node:fs';
import crypto from 'node:crypto';
const origin='https://bedos-construction-platform.vercel.app',prefix='absent-property-smoke-'+crypto.randomUUID(),id=crypto.randomUUID(),results=[];
async function request(path,method='GET') {
  const response=await fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:method==='GET'?{}:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})});
  let data=null;try{data=await response.json();}catch{}
  return {status:response.status,data,cache:response.headers.get('cache-control')};
}
function check(name,pass,status) {results.push({name,pass:!!pass,...(status?{http_status:status}:{})});if(!pass)throw Error('Production property smoke check failed');}
try {
  const r=await request('/api/properties?search='+prefix);
  check('public bounded empty property list',r.status===200&&r.data?.properties?.length===0&&r.data.pagination?.total===0&&r.data.pagination?.page===1&&r.data.pagination?.limit===12,r.status);
  check('public list not cacheable',r.cache==='no-store');
  for(const [name,path,status,method] of [
    ['missing public property','/api/properties/'+id,404,'GET'],
    ['public cannot select draft status','/api/properties?status=draft',400,'GET'],
    ['bounded page size','/api/properties?limit=101',400,'GET'],
    ['repeated query rejected','/api/properties?page=1&page=2',400,'GET'],
    ['inverted price range rejected','/api/properties?min_price=2&max_price=1',400,'GET'],
    ['invalid property ID','/api/properties/invalid',400,'GET'],
    ['management anonymous denial','/api/properties/manage',401,'GET'],
    ['create anonymous denial','/api/properties',401,'POST'],
    ['edit anonymous denial','/api/properties/'+id,401,'PATCH'],
    ['lifecycle anonymous denial','/api/properties/'+id+'/status',401,'PATCH'],
    ['delete anonymous denial','/api/properties/'+id,401,'DELETE'],
  ]) {
    const result=await request(path,method);check(name,result.status===status&&result.cache==='no-store',result.status);
  }
} catch {results.push({name:'Production property smoke checks stopped',pass:false});}
const report={date:new Date().toISOString(),scope:'Production public/anonymous checks only; no credentials, existing record contents or mutations',results};
fs.writeFileSync('docs/module-4-evidence/production-property-anonymous.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:results.length,failed:results.filter(x=>!x.pass).length,results}));
if(results.some(x=>!x.pass))process.exitCode=1;
