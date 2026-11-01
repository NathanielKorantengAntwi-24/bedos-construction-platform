// Read-only reconciliation of the exact user-run fixture journal. Never logs identities.
import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {createClient} from '@supabase/supabase-js';
const results=[];let stage='private journal guard';
function check(name,pass){stage=name;results.push({name,pass:!!pass});if(!pass)throw Error('Reconciliation stopped');}
try{
 const journal=JSON.parse(fs.readFileSync('docs/module-3-evidence/private-catalog-fixtures.json','utf8').replace(/^\uFEFF/,''));
 const workflow=JSON.parse(fs.readFileSync('docs/module-3-evidence/production-catalog-admin.json','utf8').replace(/^\uFEFF/,''));
 check('Saved administrator workflow has forty passing checks',workflow.results.length===40&&workflow.results.every(x=>x.pass));
 check('Administrator workflow logout completed',workflow.results.some(x=>x.name==='Administrator logout'&&x.http_status===200));
 const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
 check('Private journal complete with five distinct deleted identities',journal.state==='complete'&&uuid.test(journal.actor)&&journal.fixtures.length===5&&new Set(journal.fixtures.map(f=>f.id)).size===5&&journal.fixtures.every(f=>uuid.test(f.id)&&f.state==='deleted'));
 const fixtures=new Map();let nonce;
 for(const f of journal.fixtures){const match=/^bedos-catalog-([0-9a-f]{32})-(visible-category|hidden-category|draft|published|archived)$/.exec(f.slug);if(!match||!f.name.startsWith('Temporary verification ')||(nonce&&nonce!==match[1])||fixtures.has(match[2]))throw Error('Exact fixture provenance guard failed');nonce=match[1];fixtures.set(match[2],f);}
 check('Fixture kinds and shared nonce are valid',fixtures.size===5&&[...fixtures].every(([label,f])=>f.kind===(label.endsWith('category')?'service-categories':'services')));
 const env={};for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=/^\s*(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$/.exec(line);if(m)env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
 const origin='https://zjdqomckldeipigqqfqm.supabase.co';
 check('Expected production project and backend credential configured',env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')===origin&&!!env.SUPABASE_SERVICE_ROLE_KEY&&fs.readFileSync('supabase/.temp/project-ref','utf8').trim()==='zjdqomckldeipigqqfqm');
 const admin=createClient(origin,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const serviceIds=[...fixtures.values()].filter(f=>f.kind==='services').map(f=>f.id),categoryIds=[...fixtures.values()].filter(f=>f.kind==='service-categories').map(f=>f.id);
 stage='read-only fixture and audit lookup';
 const replies=await Promise.all([
  admin.from('services').select('id').in('id',serviceIds),
  admin.from('service_categories').select('id').in('id',categoryIds),
  admin.from('audit_logs').select('actor_id,action,entity_type,entity_id,metadata').in('entity_id',journal.fixtures.map(f=>f.id)),
  admin.from('profiles').select('account_status,roles(name)').eq('id',journal.actor).single(),
 ]);
 check('Independent production read requests succeed',replies.every(r=>!r.error));
 check('All three exact service fixtures are absent',replies[0].data.length===0);
 check('Both exact category fixtures are absent',replies[1].data.length===0);
 const actor=replies[3].data,role=Array.isArray(actor.roles)?actor.roles[0]:actor.roles;
 check('Original administrator remains active with administrator role',actor.account_status==='active'&&role?.name==='administrator');
 const audits=replies[2].data;
 check('Thirteen successful catalog audits retained',audits.length===13);
 check('All retained audit actors and results match',audits.every(a=>a.actor_id===journal.actor&&a.metadata?.result==='success'));
 const counts={service_created:3,service_updated:1,service_deleted:3,service_category_created:2,service_category_deleted:2,service_category_detached:2};
 check('Retained action counts exactly match the workflow',Object.keys(counts).every(action=>audits.filter(a=>a.action===action).length===counts[action])&&audits.every(a=>a.action in counts));
 const events=(id,action)=>audits.filter(a=>a.entity_id===id&&a.action===action);
 for(const [label,f] of fixtures){
  const entity=f.kind==='services'?'service':'service_category';
  const created=events(f.id,entity+'_created'),deleted=events(f.id,entity+'_deleted');
  check(`${label} creation and deletion have exact safe identity images`,created.length===1&&deleted.length===1&&audits.filter(a=>a.entity_id===f.id).every(a=>a.entity_type===entity)&&created[0].metadata.before===null&&deleted[0].metadata.after===null&&[created[0].metadata.after,deleted[0].metadata.before].every(image=>image?.id===f.id&&image.name===f.name&&image.slug===f.slug));
  if(f.kind==='services')check(`${label} creator remains the original administrator`,created[0].metadata.after.created_by===journal.actor&&deleted[0].metadata.before.created_by===journal.actor);
 }
 const draft=fixtures.get('draft'),published=fixtures.get('published'),archived=fixtures.get('archived'),visible=fixtures.get('visible-category');
 const updated=events(draft.id,'service_updated');
 check('Draft publication update records exact before and after values',updated.length===1&&updated[0].metadata.before.status==='draft'&&updated[0].metadata.after.status==='published'&&updated[0].metadata.after.featured===false&&updated[0].metadata.after.description==='Updated verification description');
 const detachments=audits.filter(a=>a.action==='service_category_detached');
 check('Only the two expected service relationships were detached',detachments.length===2&&new Set(detachments.map(a=>a.entity_id)).size===2&&detachments.every(a=>[draft.id,published.id].includes(a.entity_id)&&a.metadata.before.category_id===visible.id&&a.metadata.after.category_id===null&&a.metadata.before.id===a.entity_id&&a.metadata.after.id===a.entity_id));
 for(const [label,f] of fixtures){
  const entity=f.kind==='services'?'service':'service_category';let image=events(f.id,entity+'_created')[0].metadata.after;
  for(const action of ['service_updated','service_category_detached',entity+'_deleted']){
   for(const event of events(f.id,action)){check(`${label} ${action} preserves the prior audited image`,isDeepStrictEqual(image,event.metadata.before));image=event.metadata.after;}
  }
  check(`${label} final audited lifecycle ends in deletion`,image===null);
 }
 check('Archived fixture retains archived status until deletion',events(archived.id,'service_deleted')[0].metadata.before.status==='archived');
}catch{results.push({name:'Independent catalog reconciliation stopped',pass:false,stage});}
const report={date:new Date().toISOString(),scope:'Read-only exact-fixture database and retained-audit reconciliation; no account identities credentials slugs or record images published; no production writes',results};
fs.writeFileSync('docs/module-3-evidence/production-catalog-completion.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.pass).length,results}));
if(results.some(r=>!r.pass))process.exitCode=1;
