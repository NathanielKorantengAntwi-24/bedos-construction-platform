// Independent production reconciliation. Reads only; private identities and audit images stay in memory.
import fs from 'node:fs';
import {isDeepStrictEqual as equal} from 'node:util';
import {createClient} from '@supabase/supabase-js';
const results=[];let stage='private evidence guard';
function check(name,pass){stage=name;results.push({name,pass:!!pass});if(!pass)throw Error('Media reconciliation stopped');}
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const directory='docs/module-5-evidence';
try {
  const journal=read(directory+'/private-media-fixtures.json'),workflow=read(directory+'/production-media-admin.json');
  const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  check('Saved administrator workflow has forty-nine passing checks',workflow.results.length===49&&workflow.results.every(r=>r.pass));
  check('Administrator workflow logout completed',workflow.results.some(r=>r.name==='Administrator logout'&&r.http_status===200));
  check('Private journal complete with seven distinct deleted fixtures',journal.state==='complete'&&uuid.test(journal.actor)&&journal.fixtures.length===7&&new Set(journal.fixtures.map(f=>f.id)).size===7&&journal.fixtures.every(f=>uuid.test(f.id)&&f.state==='deleted'));
  const properties=journal.fixtures.filter(f=>f.kind==='properties'),children=journal.fixtures.filter(f=>f.kind!=='properties');
  const gallery=properties.find(f=>f.slug.endsWith('-gallery')),other=properties.find(f=>f.slug.endsWith('-cross-parent'));
  const nonce=gallery?.slug.match(/^bedos-media-([0-9a-f]{32})-gallery$/)?.[1];
  check('Exact two-property fixture provenance',properties.length===2&&!!nonce&&other?.slug===`bedos-media-${nonce}-cross-parent`&&properties.every(f=>f.title===`Temporary verification bedos-media-${nonce} ${f===gallery?'gallery':'cross-parent'}`));
  const labels={images:['image-one','image-two'],'floor-plans':['floor-plan'],features:['feature'],amenities:['amenity']};
  check('Five expected children share only the gallery parent',children.length===5&&children.every(f=>f.parent===gallery.id&&labels[f.kind]?.some(label=>f.title===`Temporary verification bedos-media-${nonce} ${label}`)&&uuid.test(f.key))&&Object.entries(labels).every(([kind,names])=>children.filter(f=>f.kind===kind).length===names.length));
  const env={};for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){
    const m=/^\s*(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$/.exec(line);if(m)env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
  }
  const origin='https://zjdqomckldeipigqqfqm.supabase.co';
  check('Expected production project and backend credential configured',env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')===origin&&!!env.SUPABASE_SERVICE_ROLE_KEY&&fs.readFileSync('supabase/.temp/project-ref','utf8').trim()==='zjdqomckldeipigqqfqm');
  const admin=createClient(origin,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})}});
  const ids=journal.fixtures.map(f=>f.id),propertyIds=properties.map(f=>f.id);
  stage='independent production record reads';
  const replies=await Promise.all([
    admin.from('properties').select('id').in('id',propertyIds),
    admin.from('properties').select('id').like('slug',`bedos-media-${nonce}-%`),
    ...['property_images','property_floor_plans','property_features','property_amenities'].map(table=>admin.from(table).select('id').or(`id.in.(${ids.join(',')}),property_id.in.(${propertyIds.join(',')})`)),
    admin.from('audit_logs').select('actor_id,action,entity_type,entity_id,metadata').in('entity_id',ids),
    admin.from('profiles').select('account_status,roles(name)').eq('id',journal.actor).single(),
  ]);
  check('Independent production record reads succeed',replies.every(r=>!r.error));
  check('Both exact property IDs and shared nonce are absent',replies[0].data.length===0&&replies[1].data.length===0);
  for(let i=0;i<4;i++)check(`${['Image','Floor plan','Feature','Amenity'][i]} exact IDs and parent references absent`,replies[i+2].data.length===0);
  const actor=replies[7].data,role=Array.isArray(actor.roles)?actor.roles[0]:actor.roles;
  check('Original administrator remains active with administrator role',actor.account_status==='active'&&role?.name==='administrator');
  const business=replies[6].data;
  check('Twenty-two successful business audits retained',business.length===22&&business.every(a=>a.actor_id===journal.actor&&a.metadata?.result==='success'));
  for(const f of journal.fixtures){
    const entity={properties:'property',images:'property_image','floor-plans':'property_floor_plan',features:'property_feature',amenities:'property_amenity'}[f.kind];
    const events=business.filter(a=>a.entity_id===f.id),created=events.filter(a=>a.action===entity+'_created'),deleted=events.filter(a=>a.action===entity+'_deleted');
    const label=f.kind==='properties'?(f===gallery?'gallery property':'cross-parent property'):f.title.split(' ').at(-1);
    check(`${label} exact creation and deletion audit boundaries`,created.length===1&&deleted.length===1&&events.every(a=>a.entity_type===entity)&&created[0].metadata.before===null&&deleted[0].metadata.after===null&&created[0].metadata.after?.id===f.id&&deleted[0].metadata.before?.id===f.id);
    let image=created[0].metadata.after;
    const titleField={properties:'title',images:'alt_text','floor-plans':'title',features:'name',amenities:'name'}[f.kind];
    check(`${label} creation binds exact fixture identity`,image[titleField]===f.title&&(f.kind==='properties'?image.slug===f.slug&&image.created_by===journal.actor&&image.status==='draft':image.property_id===gallery.id));
    const edits=events.filter(a=>!a.action.endsWith('_created')&&!a.action.endsWith('_deleted'));
    const expectedEdits=f.kind==='properties'?(f===gallery?2:0):f.kind==='images'?(f.title.endsWith('image-one')?2:1):1;
    check(`${label} audit count excludes rejected or replayed mutations`,edits.length===expectedEdits&&events.length===expectedEdits+2);
    for(let i=0;i<expectedEdits;i++){
      const candidates=edits.filter(a=>equal(a.metadata.before,image));
      check(`${label} audit chain step ${i+1}`,candidates.length===1);const event=candidates[0];image=event.metadata.after;edits.splice(edits.indexOf(event),1);
    }
    check(`${label} deletion continues exact final audited image`,equal(image,deleted[0].metadata.before));
    if(f.kind==='properties'){
      check(`${label} deletion cascaded no remaining media metadata`,equal(deleted[0].metadata.deleted_metadata,{features:[],amenities:[]}));
      if(f===gallery){
        const lifecycle=events.filter(a=>a.action==='property_status_changed');
        check('Gallery publication and withdrawal retain exact reasons',lifecycle.some(a=>a.metadata.before.status==='draft'&&a.metadata.after.status==='published'&&a.metadata.reason==='Dedicated property media verification')&&lifecycle.some(a=>a.metadata.before.status==='published'&&a.metadata.after.status==='unavailable'&&a.metadata.reason==='Dedicated property media withdrawal verification'));
      }
    }else if(f.kind==='images'){
      const first=f.title.endsWith('image-one');
      check(`${label} final primary flag and order are correct`,image.is_primary===first&&image.display_order===(first?0:1));
    }else if(f.kind==='floor-plans')check('Floor plan final description is audited',image.description==='Verified test floor plan');
    else if(f.kind==='features')check('Feature final value is audited',image.value==='Verified feature');
  }
  const files=children.filter(f=>['images','floor-plans'].includes(f.kind));
  const operationIds=files.map(f=>business.find(a=>a.entity_id===f.id&&a.action.endsWith('_created'))?.metadata?.operation_id);
  check('Exactly three upload operations bind the created files',operationIds.every(id=>uuid.test(id))&&new Set(operationIds).size===3);
  stage='read-only operation and audit lookup';
  const [operationAudits,...statuses]=await Promise.all([
    admin.from('audit_logs').select('actor_id,action,entity_type,entity_id,metadata').in('entity_id',operationIds),
    ...operationIds.map(id=>admin.rpc('bedos_media_operation',{p_actor:journal.actor,p_action:'status',p_operation:id})),
  ]);
  check('Read-only operation status and audit requests succeed',!operationAudits.error&&statuses.every(r=>!r.error));
  check('Nine exact operation audits retained',operationAudits.data.length===9&&operationAudits.data.every(a=>a.actor_id===journal.actor&&a.entity_type==='property_media_operation'&&a.metadata?.result==='success'));
  for(let i=0;i<files.length;i++){
    const f=files[i],op=statuses[i].data,label=f.title.split(' ').at(-1),kind=f.kind==='images'?'images':'floor_plans';
    const bucket=kind==='images'?'property-images':'property-floor-plans',expectedPath=`properties/${gallery.id}/${operationIds[i]}.png`;
    check(`${label} retained operation proves terminal exact ownership`,op.id===operationIds[i]&&op.actor_id===journal.actor&&op.bound_property_id===gallery.id&&op.property_id===null&&op.media_id===f.id&&op.idempotency_key===f.key&&op.kind===kind&&op.bucket_id===bucket&&op.storage_path===expectedPath&&op.state==='deleted'&&op.version===4);
    check(`${label} retained file proof is bounded and valid`,op.mime==='image/png'&&Number.isInteger(op.file_size)&&op.file_size>0&&op.file_size<=3145728&&/^[0-9a-f]{64}$/.test(op.sha256));
    const events=operationAudits.data.filter(a=>a.entity_id===op.id);
    const start=events.find(a=>a.action==='property_media_upload_started'),request=events.find(a=>a.action==='property_media_cleanup_requested'),complete=events.find(a=>a.action==='property_media_cleanup_completed');
    check(`${label} operation lifecycle audited exactly once`,events.length===3&&!!start&&!!request&&!!complete&&start.metadata.before===null&&start.metadata.after.state==='upload_pending'&&start.metadata.after.version===1&&request.metadata.before.state==='ready'&&request.metadata.before.version===2&&request.metadata.after.state==='cleanup_pending'&&request.metadata.after.version===3&&equal(complete.metadata.before,request.metadata.after)&&equal(complete.metadata.after,{state:'deleted'}));
    const immutable=['id','bound_property_id','actor_id','kind','media_id','idempotency_key','bucket_id','storage_path','mime','file_size','sha256','input','created_at'];
    check(`${label} immutable file provenance preserved across recovery`,immutable.every(k=>equal(start.metadata.after[k],op[k])&&equal(request.metadata.before[k],op[k])&&equal(request.metadata.after[k],op[k])));
    const fileEvents=business.filter(a=>a.entity_id===f.id),created=fileEvents.find(a=>a.action.endsWith('_created')),deleted=fileEvents.find(a=>a.action.endsWith('_deleted'));
    check(`${label} file creation and deletion bind the same operation`,created.metadata.operation_id===op.id&&deleted.metadata.operation_id===op.id&&created.metadata.after.storage_path===expectedPath&&deleted.metadata.before.storage_path===expectedPath);
    stage='independent provider object absence';
    const [listing,download]=await Promise.all([admin.storage.from(bucket).list(`properties/${gallery.id}`,{limit:100}),admin.storage.from(bucket).download(expectedPath)]);
    check(`${label} provider prefix has no remaining objects`,!listing.error&&listing.data.length===0);
    check(`${label} exact provider object no longer downloadable`,!!download.error&&(String(download.error.statusCode)==='404'||/object not found/i.test(download.error.message)));
  }
}catch{results.push({name:'Independent property media reconciliation stopped',pass:false,stage});}
const report={date:new Date().toISOString(),scope:'Independent exact-fixture metadata/provider absence, terminal operation provenance and retained audit-chain checks; status RPC only, no mutations; identities credentials object paths and audit images remain private',results};
fs.writeFileSync(directory+'/production-media-completion.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:results.length,failed:results.filter(r=>!r.pass).length,results}));
if(results.some(r=>!r.pass))process.exitCode=1;
