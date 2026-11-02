// Read-only reconciliation. Private identities, notification IDs and audit images never print.
import fs from 'node:fs';
import {isDeepStrictEqual as equal} from 'node:util';
import {createClient} from '@supabase/supabase-js';
const directory='docs/module-6-evidence',results=[];let stage='saved evidence guard';
const check=(name,pass)=>{stage=name;results.push({name,pass:!!pass});if(!pass)throw Error('Viewing reconciliation stopped');};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
try{
 const journal=read(directory+'/private-viewing-fixtures.json'),workflow=read(directory+'/production-viewing-admin.json');
 check('Fifty saved administrator acceptance checks passed',workflow.results.length===50&&workflow.results.every(r=>r.pass));
 check('Administrator workflow logout succeeded',workflow.results.some(r=>r.name==='Administrator logout'&&r.http_status===200));
 check('Private journal complete with six distinct deleted fixtures',journal.state==='complete'&&uuid.test(journal.actor)&&journal.fixtures.length===6&&journal.fixtures.every(f=>uuid.test(f.id)&&f.state==='deleted')&&new Set(journal.fixtures.map(f=>f.id)).size===6);
 const properties=journal.fixtures.filter(f=>f.kind==='property'),customers=journal.fixtures.filter(f=>f.kind==='customer'),viewings=journal.fixtures.filter(f=>f.kind==='viewing');
 const gallery=properties.find(f=>f.slug.endsWith('-gallery')),draft=properties.find(f=>f.slug.endsWith('-draft')),nonce=gallery?.slug.match(/^bedos-viewing-([0-9a-f]{32})-gallery$/)?.[1],prefix='bedos-viewing-'+nonce;
 check('Two exact property identities share the approved nonce',properties.length===2&&!!nonce&&draft?.slug===prefix+'-draft'&&properties.every(f=>f.title===`Temporary viewing verification ${prefix} ${f===gallery?'gallery':'draft'}`));
 const one=customers.find(f=>f.email===prefix+'-one@bedos-production-viewing-test.invalid'),two=customers.find(f=>f.email===prefix+'-two@bedos-production-viewing-test.invalid');
 check('Two exact customer identities match private fixture provenance',customers.length===2&&!!one&&!!two&&one.name===`Temporary viewing customer ${prefix} one`&&two.name===`Temporary viewing customer ${prefix} two`&&customers.every(f=>f.id!==journal.actor));
 const first=viewings.find(f=>f.customer===one.id),second=viewings.find(f=>f.customer===two.id);
 check('Two exact viewing identities match customer parent and final versions',viewings.length===2&&!!first&&!!second&&viewings.every(f=>f.parent===gallery.id)&&first.version===6&&second.version===2&&first.message===`Temporary viewing verification ${prefix} one`&&second.message===`Temporary viewing verification ${prefix} two`);
 check('Private event proof is unique and terminal',journal.events.length>0&&new Set(journal.events.map(e=>e.id)).size===journal.events.length&&journal.events.every(e=>uuid.test(e.id)&&viewings.some(v=>v.id===e.viewing_id)&&['recorded','suppressed'].includes(e.state)));
 const env={};for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=/^\s*(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$/.exec(line);if(m)env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
 const origin='https://zjdqomckldeipigqqfqm.supabase.co';
 check('Expected production project and read credential guard',env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')===origin&&!!env.SUPABASE_SERVICE_ROLE_KEY&&fs.readFileSync('supabase/.temp/project-ref','utf8').trim()==='zjdqomckldeipigqqfqm');
 const admin=createClient(origin,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})}});
 stage='independent production record reads';
 const viewingIds=viewings.map(f=>f.id),propertyIds=properties.map(f=>f.id),customerIds=customers.map(f=>f.id),entityIds=[...journal.fixtures,...journal.events].map(f=>f.id);
 const replies=await Promise.all([
  admin.from('properties').select('id').in('id',propertyIds),admin.from('properties').select('id').like('slug',prefix+'-%'),
  admin.from('viewing_requests').select('id').or(`id.in.(${viewingIds}),property_id.in.(${propertyIds}),customer_id.in.(${customerIds})`),
  admin.from('profiles').select('id').in('id',customerIds),
  admin.from('audit_logs').select('actor_id,action,entity_type,entity_id,metadata').in('entity_id',entityIds),
  admin.from('profiles').select('account_status,roles(name)').eq('id',journal.actor).single(),
  ...customers.map(f=>admin.auth.admin.getUserById(f.id)),
 ]);
 check('Independent record profile and audit reads succeed',replies.slice(0,6).every(r=>!r.error));
 check('Both property IDs and exact nonce absent',replies[0].data.length===0&&replies[1].data.length===0);
 check('Viewing IDs property references and customer references absent',replies[2].data.length===0);
 check('Both disposable customer profiles absent',replies[3].data.length===0);
 check('Both exact disposable Auth users absent',replies.slice(6).every(r=>r.error?.status===404&&!r.data.user));
 const original=replies[5].data,role=Array.isArray(original.roles)?original.roles[0]:original.roles;
 check('Original administrator still active with administrator role',original.account_status==='active'&&role?.name==='administrator');
 const audits=replies[4].data,propertyAudits=audits.filter(a=>a.entity_type==='property'),viewingAudits=audits.filter(a=>a.entity_type==='viewing_request'),eventAudits=audits.filter(a=>a.entity_type==='viewing_notification_event');
 check('Six property and ten viewing business audits retained',propertyAudits.length===6&&viewingAudits.length===10&&audits.length===propertyAudits.length+viewingAudits.length+eventAudits.length&&audits.every(a=>a.metadata?.result==='success'));
 for(const f of properties){
  const label=f===gallery?'Gallery property':'Draft property',events=propertyAudits.filter(a=>a.entity_id===f.id),creation=events.filter(a=>a.action==='property_created'),deletion=events.filter(a=>a.action==='property_deleted');
  check(label+' exact creation deletion and administrator',creation.length===1&&deletion.length===1&&events.every(a=>a.actor_id===journal.actor)&&creation[0].metadata.before===null&&deletion[0].metadata.after===null);
  let image=creation[0].metadata.after;check(label+' original identity and draft defaults',image.id===f.id&&image.title===f.title&&image.slug===f.slug&&image.created_by===journal.actor&&image.status==='draft'&&image.property_type==='verification'&&image.listing_type==='verification');
  const changes=events.filter(a=>a.action==='property_status_changed'),expected=f===gallery?['published','unavailable']:[];
  check(label+' exact lifecycle count',changes.length===expected.length&&events.length===expected.length+2);
  for(const [i,status]of expected.entries()){const match=changes.filter(a=>equal(a.metadata.before,image));check(label+' lifecycle chain '+(i+1),match.length===1&&match[0].metadata.after.status===status&&match[0].metadata.reason===(i===0?'Dedicated production viewing verification':'Dedicated viewing withdrawal verification'));const previous=image;image=match[0].metadata.after;check(label+' specifications unchanged '+(i+1),Object.keys(image).every(k=>['status','updated_at'].includes(k)||equal(image[k],previous[k])));}
  check(label+' deletion continues exact image without cascaded metadata',equal(deletion[0].metadata.before,image)&&equal(deletion[0].metadata.deleted_metadata,{features:[],amenities:[]}));
 }
 const mutations=[];
 for(const f of viewings){
  const label=f===first?'First viewing':'Second viewing',events=viewingAudits.filter(a=>a.entity_id===f.id),created=events.filter(a=>a.action==='viewing_request_created'),deleted=events.filter(a=>a.action==='viewing_request_deleted'),updated=events.filter(a=>a.action==='viewing_request_updated');
  check(label+' exact mutation counts reject duplicate or failed operations',created.length===1&&deleted.length===1&&updated.length===f.version-1&&events.length===f.version+1);
  let image=created[0].metadata.after;
  check(label+' creation identity version and nullable preferences',created[0].metadata.before===null&&created[0].actor_id===null&&image.id===f.id&&image.property_id===gallery.id&&image.customer_id===f.customer&&image.message===f.message&&image.version===1&&image.status==='new'&&image.assigned_to===null&&image.preferred_date==='2027-01-15'&&image.preferred_time===null);
  mutations.push({viewing_id:f.id,version:1,actor:f.customer});
  const states=f===first?['new','contacted','scheduled','scheduled','completed']:['cancelled'];
  for(let version=2;version<=f.version;version++){
   const match=updated.filter(a=>a.metadata.after?.version===version);check(label+' continuous audit version '+version,match.length===1&&equal(match[0].metadata.before,image));const event=match[0],previous=image;image=event.metadata.after;
   const own=f===second||version===2,expectedActor=own?f.customer:journal.actor;
   check(label+' actor retention and canonical state '+version,event.actor_id===(own?null:journal.actor)&&image.status===states[version-2]&&image.id===f.id&&image.property_id===gallery.id&&image.customer_id===f.customer&&image.message===f.message);
   const allowed=f===second?['status']:version===2?['preferred_time']:version===3?['status','assigned_to']:version===5?['preferred_time']:['status'];
   check(label+' only expected fields changed '+version,Object.keys(image).every(k=>['version','updated_at',...allowed].includes(k)||equal(image[k],previous[k])));
   mutations.push({viewing_id:f.id,version,actor:expectedActor});
  }
  check(label+' exact final schedule and assignment',image.version===f.version&&(f===first?image.status==='completed'&&image.assigned_to===journal.actor&&image.preferred_time==='11:30:00':image.status==='cancelled'&&image.assigned_to===null&&image.preferred_time===null));
  check(label+' administrator deletion continues final audited image',deleted[0].actor_id===journal.actor&&deleted[0].metadata.after===null&&equal(deleted[0].metadata.before,image));
 }
 stage='read-only private queue projection';
 const retained=[];let page=1,total=0;
 do{const r=await admin.rpc('bedos_viewing_events',{p_actor:journal.actor,p_page:page,p_limit:100});if(r.error||page>100)throw Error('Bounded queue read failed');total=r.data.pagination.total;retained.push(...r.data.events.filter(e=>viewingIds.includes(e.viewing_id)));page++;}while((page-1)*100<total);
 check('All exact retained queue identities match private journal',retained.length===journal.events.length&&retained.every(e=>journal.events.some(p=>p.id===e.id&&['viewing_id','event_type','state','attempts','version'].every(k=>equal(e[k],p[k])))));
 check('Every fixture event is terminal with bounded valid attempt proof',retained.every(e=>['recorded','suppressed'].includes(e.state)&&Number.isInteger(e.attempts)&&e.attempts>=0&&Number.isInteger(e.version)&&e.version>=2));
 const recorded=retained.filter(e=>e.state==='recorded'),suppressed=retained.filter(e=>e.state==='suppressed'),notificationIds=[];
 for(const e of retained){
  const label='Event '+(retained.indexOf(e)+1),events=eventAudits.filter(a=>a.entity_id===e.id),terminal=events.filter(a=>a.action==='viewing_notification_'+(e.state==='recorded'?'recorded':'suppressed'));
  check(label+' exactly one terminal audit',terminal.length===1&&terminal[0].metadata.before===null&&terminal[0].metadata.after?.state===e.state&&events.every(a=>['viewing_notification_recorded','viewing_notification_suppressed','viewing_notification_retry_failed'].includes(a.action)));
  if(e.state==='recorded'){const id=terminal[0].metadata.after.notification_id;check(label+' generated notification identity retained',uuid.test(id));notificationIds.push(id);}
  check(label+' attempt count reconciles retry history',events.filter(a=>a.action==='viewing_notification_retry_failed').length===e.attempts-(e.state==='recorded'?1:0));
 }
 check('All generated notification identities are unique',new Set(notificationIds).size===notificationIds.length);
 check('Business audit total event count matches retained queue',viewingAudits.filter(a=>a.action!=='viewing_request_deleted').reduce((n,a)=>n+a.metadata.notification_event_count,0)===retained.length);
 stage='independent exact notification absence';
 const notificationQuery=admin.from('notifications').select('id').or(`related_entity_id.in.(${viewingIds})${notificationIds.length?',id.in.('+notificationIds+')':''}`);
 const notifications=await notificationQuery;
 check('All exact notification IDs and viewing-related notifications absent',!notifications.error&&notifications.data.length===0);
 const payload={actor:journal.actor,properties,customers,viewings,events:journal.events,mutations};
 const encoded=JSON.stringify(payload);if(encoded.includes('$m6_fixture_expected$'))throw Error('SQL quote guard');
 const verification=`-- Private exact-fixture reconciliation. READ ONLY. Do not commit this generated file.
BEGIN TRANSACTION READ ONLY;
WITH expected AS(SELECT $m6_fixture_expected$${encoded}$m6_fixture_expected$::jsonb data),
views AS(SELECT v.* FROM expected e CROSS JOIN LATERAL jsonb_to_recordset(e.data->'viewings') v(id uuid,parent uuid,customer uuid,version integer,message text)),
customers AS(SELECT c.* FROM expected e CROSS JOIN LATERAL jsonb_to_recordset(e.data->'customers') c(id uuid,email text)),
events AS(SELECT x.* FROM expected e CROSS JOIN LATERAL jsonb_to_recordset(e.data->'events') x(id uuid,viewing_id uuid,event_type text,state text,attempts integer,version integer)),
actors AS(SELECT x.* FROM expected e CROSS JOIN LATERAL jsonb_to_recordset(e.data->'mutations') x(viewing_id uuid,version integer,actor uuid)),
mutations AS(SELECT a.metadata->'after' image,actors.actor FROM public.audit_logs a JOIN actors ON a.entity_id=actors.viewing_id AND (a.metadata->'after'->>'version')::integer=actors.version WHERE a.entity_type='viewing_request' AND a.action IN('viewing_request_created','viewing_request_updated')),
queue AS(SELECT q.* FROM public.viewing_notification_events q WHERE q.viewing_id IN(SELECT id FROM views)),
checks AS(
 SELECT 'Exact queue identities and terminal fields' name,(SELECT count(*) FROM queue)=(SELECT count(*) FROM events) AND NOT EXISTS(SELECT 1 FROM events e LEFT JOIN queue q ON q.id=e.id WHERE q.id IS NULL OR (q.viewing_id,q.event_type,q.state,q.attempts,q.version) IS DISTINCT FROM (e.viewing_id,e.event_type,e.state,e.attempts,e.version)) pass
 UNION ALL SELECT 'Queue immutable creator and request version match audit',NOT EXISTS(SELECT 1 FROM queue q LEFT JOIN mutations m ON (m.image->>'id')::uuid=q.viewing_id AND (m.image->>'version')::integer=q.viewing_version WHERE m.image IS NULL OR q.created_by<>m.actor)
 UNION ALL SELECT 'Queue immutable status assignment and schedule match audit',NOT EXISTS(SELECT 1 FROM queue q JOIN mutations m ON (m.image->>'id')::uuid=q.viewing_id AND (m.image->>'version')::integer=q.viewing_version WHERE q.expected_status IS DISTINCT FROM m.image->>'status' OR q.expected_assigned_to IS DISTINCT FROM (m.image->>'assigned_to')::uuid OR q.preferred_date IS DISTINCT FROM (m.image->>'preferred_date')::date OR q.preferred_time IS DISTINCT FROM (m.image->>'preferred_time')::time)
 UNION ALL SELECT 'Customer events bind exact deleted customer',NOT EXISTS(SELECT 1 FROM queue q JOIN views v ON v.id=q.viewing_id WHERE q.event_type LIKE 'customer_%' AND q.recipient_id<>v.customer)
 UNION ALL SELECT 'Assigned staff events bind approved assignment',NOT EXISTS(SELECT 1 FROM queue q WHERE q.event_type IN('assigned','staff_status','staff_schedule') AND q.recipient_id IS DISTINCT FROM q.expected_assigned_to)
 UNION ALL SELECT 'Staff notice targets remain active authorized staff',NOT EXISTS(SELECT 1 FROM queue q WHERE q.event_type NOT LIKE 'customer_%' AND NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id JOIN public.role_permissions rp ON rp.role_id=p.role_id JOIN public.permissions pm ON pm.id=rp.permission_id WHERE p.id=q.recipient_id AND p.account_status='active' AND r.name IN('administrator','sales_customer_service') AND pm.name='viewings.view'))
 UNION ALL SELECT 'Exactly one initial customer and original administrator notice',NOT EXISTS(SELECT 1 FROM views v WHERE (SELECT count(*) FROM queue q WHERE q.viewing_id=v.id AND q.viewing_version=1 AND q.event_type='customer_new' AND q.recipient_id=v.customer)<>1 OR (SELECT count(*) FROM queue q WHERE q.viewing_id=v.id AND q.viewing_version=1 AND q.event_type='staff_new' AND q.recipient_id=(SELECT (data->>'actor')::uuid FROM expected))<>1)
 UNION ALL SELECT 'Queue event counts match each business audit',NOT EXISTS(SELECT 1 FROM mutations m WHERE (SELECT count(*) FROM queue q WHERE q.viewing_id=(m.image->>'id')::uuid AND q.viewing_version=(m.image->>'version')::integer)<>(SELECT (a.metadata->>'notification_event_count')::integer FROM public.audit_logs a WHERE a.entity_id=(m.image->>'id')::uuid AND a.action IN('viewing_request_created','viewing_request_updated') AND (a.metadata->'after'->>'version')::integer=(m.image->>'version')::integer))
 UNION ALL SELECT 'Queue recorded notification proof matches terminal audit',NOT EXISTS(SELECT 1 FROM queue q WHERE q.state='recorded' AND NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.entity_type='viewing_notification_event' AND a.entity_id=q.id AND a.action='viewing_notification_recorded' AND a.metadata->'after'->>'notification_id'=q.notification_id::text))
 UNION ALL SELECT 'Queue materialization actor and deleted-customer retention',NOT EXISTS(SELECT 1 FROM queue q JOIN public.audit_logs a ON a.entity_id=q.id AND a.action IN('viewing_notification_recorded','viewing_notification_suppressed','viewing_notification_retry_failed') WHERE a.actor_id IS DISTINCT FROM (SELECT (data->>'actor')::uuid FROM expected) AND NOT (a.actor_id IS NULL AND q.created_by IN(SELECT id FROM customers)))
 UNION ALL SELECT 'Expected customer audit headers cleared and administrator retained',NOT EXISTS(SELECT 1 FROM actors x JOIN public.audit_logs a ON a.entity_id=x.viewing_id AND a.action IN('viewing_request_created','viewing_request_updated') AND (a.metadata->'after'->>'version')::integer=x.version WHERE a.actor_id IS DISTINCT FROM CASE WHEN x.actor=(SELECT (data->>'actor')::uuid FROM expected) THEN x.actor ELSE NULL END)
 UNION ALL SELECT 'Existing actor foreign key uses SET NULL on profile deletion',EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid='public.audit_logs'::regclass AND c.confrelid='public.profiles'::regclass AND c.contype='f' AND c.confdeltype='n' AND a.attname='actor_id')
 UNION ALL SELECT 'Exact customer Auth IDs and email addresses absent',NOT EXISTS(SELECT 1 FROM auth.users u JOIN customers c ON u.id=c.id OR u.email=c.email)
 UNION ALL SELECT 'Queue notification IDs and viewing references absent',NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.id IN(SELECT notification_id FROM queue) OR (n.related_entity_type='viewing_request' AND n.related_entity_id IN(SELECT id FROM views)))
 UNION ALL SELECT 'Every fixture event terminal and unique',NOT EXISTS(SELECT 1 FROM queue WHERE state NOT IN('recorded','suppressed')) AND (SELECT count(DISTINCT notification_id) FROM queue)=(SELECT count(*) FROM queue)
)
SELECT jsonb_build_object('checks',(SELECT jsonb_object_agg(name,pass) FROM checks),'all_passed',(SELECT bool_and(pass) FROM checks),'queue_count',(SELECT count(*) FROM queue),'recorded_count',(SELECT count(*) FROM queue WHERE state='recorded'),'suppressed_count',(SELECT count(*) FROM queue WHERE state='suppressed'),'nulled_customer_audit_headers',(SELECT count(*) FROM public.audit_logs WHERE actor_id IS NULL AND entity_id IN(SELECT id FROM views UNION SELECT id FROM queue))) evidence;
COMMIT;
`;
 fs.mkdirSync('.next/module6-release',{recursive:true});fs.writeFileSync('.next/module6-release/05-independent-fixture-verification.sql',verification);
 check('Private queue proof query prepared for read-only dashboard execution',true);
}catch{results.push({name:'Independent production viewing reconciliation stopped',pass:false,stage});}
const report={date:new Date().toISOString(),scope:'Read-only exact-fixture record/Auth/notification absence, safe queue projection and audit-chain reconciliation; private IDs and raw images not published; private queue SQL proof is separate',auditActorRetention:'Deleted customer profiles clear audit actor_id through the existing FK; customer IDs remain in viewing audit images and event created_by is retained',results};
fs.writeFileSync(directory+'/production-viewing-independent-api.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.pass).length,results}));if(results.some(r=>!r.pass))process.exitCode=1;
