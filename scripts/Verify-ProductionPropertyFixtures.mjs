// Read-only exact-fixture reconciliation. Private identities and audit images never leave memory.
import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {createClient} from '@supabase/supabase-js';
const results=[];let stage='private journal guard';
function check(name,pass){stage=name;results.push({name,pass:!!pass});if(!pass)throw Error('Property reconciliation stopped');}
try {
  const read=path=>JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''));
  const journal=read('docs/module-4-evidence/private-property-fixtures.json');
  const workflow=read('docs/module-4-evidence/production-property-admin.json');
  check('Saved administrator workflow has thirty-five passing checks',workflow.results.length===35&&workflow.results.every(r=>r.pass));
  check('Administrator workflow logout completed',workflow.results.some(r=>r.name==='Administrator logout'&&r.http_status===200));
  const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  check('Private journal complete with two distinct deleted identities',journal.state==='complete'&&uuid.test(journal.actor)&&journal.fixtures.length===2&&new Set(journal.fixtures.map(f=>f.id)).size===2&&journal.fixtures.every(f=>uuid.test(f.id)&&f.state==='deleted'));
  const fixtures=new Map();let nonce;
  for(const f of journal.fixtures){
    const match=/^bedos-property-([0-9a-f]{32})-(lifecycle|sale-status)$/.exec(f.slug);
    if(!match||(nonce&&nonce!==match[1])||fixtures.has(match[2])||f.title!==`Temporary verification bedos-property-${match[1]} ${match[2]}`)throw Error('Exact fixture provenance guard failed');
    nonce=match[1];fixtures.set(match[2],f);
  }
  check('Both expected labels share the exact fixture nonce',fixtures.has('lifecycle')&&fixtures.has('sale-status'));
  const env={};for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){
    const match=/^\s*(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$/.exec(line);
    if(match)env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');
  }
  const origin='https://zjdqomckldeipigqqfqm.supabase.co';
  check('Expected production project and backend credential configured',env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')===origin&&!!env.SUPABASE_SERVICE_ROLE_KEY&&fs.readFileSync('supabase/.temp/project-ref','utf8').trim()==='zjdqomckldeipigqqfqm');
  const admin=createClient(origin,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  stage='independent production lookup';
  const ids=journal.fixtures.map(f=>f.id);
  const replies=await Promise.all([
    admin.from('properties').select('id').in('id',ids),
    admin.from('properties').select('id').like('slug',`bedos-property-${nonce}-%`),
    admin.from('audit_logs').select('actor_id,action,entity_type,entity_id,metadata').in('entity_id',ids),
    admin.from('profiles').select('account_status,roles(name)').eq('id',journal.actor).single(),
  ]);
  check('Independent production read requests succeed',replies.every(r=>!r.error));
  check('Both exact property fixture IDs are absent',replies[0].data.length===0);
  check('No properties remain under the exact fixture nonce',replies[1].data.length===0);
  const actor=replies[3].data,role=Array.isArray(actor.roles)?actor.roles[0]:actor.roles;
  check('Original administrator remains active with administrator role',actor.account_status==='active'&&role?.name==='administrator');
  const audits=replies[2].data;
  check('Fourteen successful property audits retained',audits.length===14);
  check('Every retained actor entity and result matches',audits.every(a=>a.actor_id===journal.actor&&a.entity_type==='property'&&a.metadata?.result==='success'));
  const counts={property_created:2,property_updated:1,property_status_changed:9,property_deleted:2};
  check('Action counts exactly match successful workflow mutations',audits.every(a=>a.action in counts)&&Object.entries(counts).every(([action,count])=>audits.filter(a=>a.action===action).length===count));
  for(const [label,f] of fixtures){
    const events=audits.filter(a=>a.entity_id===f.id),created=events.filter(a=>a.action==='property_created'),deleted=events.filter(a=>a.action==='property_deleted');
    check(`${label} exact creation and deletion identity images`,created.length===1&&deleted.length===1&&created[0].metadata.before===null&&deleted[0].metadata.after===null&&[created[0].metadata.after,deleted[0].metadata.before].every(image=>image?.id===f.id&&image.title===f.title&&image.slug===f.slug&&image.created_by===journal.actor));
    let image=created[0].metadata.after;
    check(`${label} creation uses expected draft defaults`,image.status==='draft'&&image.featured===false&&image.price===123.45&&image.currency==='GHS'&&image.bedrooms===2&&image.bathrooms===1);
    const updated=events.filter(a=>a.action==='property_updated');
    check(`${label} specification edit count is correct`,updated.length===(label==='lifecycle'?1:0));
    if(label==='lifecycle'){
      check('Specification edit preserves exact previous image',isDeepStrictEqual(updated[0].metadata.before,image));image=updated[0].metadata.after;
      check('Specification edit records only expected business changes',image.featured===true&&image.city==='Verification'&&image.description==='Temporary verification description'&&image.status==='draft'&&image.price===123.45&&Object.keys(image).every(key=>['featured','city','description','updated_at'].includes(key)||isDeepStrictEqual(image[key],updated[0].metadata.before[key])));
    }
    const states=label==='lifecycle'?['draft','published','reserved','published','unavailable','archived','draft']:['draft','published','sold','archived'];
    const statusEvents=events.filter(a=>a.action==='property_status_changed');
    check(`${label} successful lifecycle transition count`,statusEvents.length===states.length-1);
    for(let i=1;i<states.length;i++){
      const matches=statusEvents.filter(a=>a.metadata.before?.status===states[i-1]&&a.metadata.after?.status===states[i]);
      check(`${label} ${states[i-1]} to ${states[i]} audited exactly once`,matches.length===1&&matches[0].metadata.reason==='Dedicated production property verification');
      const event=matches[0];
      check(`${label} lifecycle step ${i} preserves prior audited image`,isDeepStrictEqual(image,event.metadata.before));
      check(`${label} lifecycle step ${i} preserves specifications`,Object.keys(event.metadata.after).every(key=>['status','updated_at'].includes(key)||isDeepStrictEqual(event.metadata.after[key],image[key])));
      image=event.metadata.after;
    }
    check(`${label} deletion continues exact audited image`,isDeepStrictEqual(image,deleted[0].metadata.before));
    check(`${label} deletion cascaded no feature or amenity metadata`,isDeepStrictEqual(deleted[0].metadata.deleted_metadata,{features:[],amenities:[]}));
  }
} catch {results.push({name:'Independent property reconciliation stopped',pass:false,stage});}
const report={date:new Date().toISOString(),scope:'Read-only exact-fixture absence and retained audit-chain reconciliation; no production writes; no identities credentials slugs or audit images published',results};
fs.writeFileSync('docs/module-4-evidence/production-property-completion.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.pass).length,results}));
if(results.some(r=>!r.pass))process.exitCode=1;
