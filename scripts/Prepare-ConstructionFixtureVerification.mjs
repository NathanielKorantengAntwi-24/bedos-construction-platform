// Prepares a private read-only SQL query. Does not connect to production.
import fs from 'node:fs';
const path='docs/module-7-evidence/private-project-fixtures.json';
const j=JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
if(j.state!=='complete'||!uuid(j.actor)||!/^bedos-project-[a-f0-9]{32}$/.test(j.prefix)||!Array.isArray(j.fixtures)||j.fixtures.length!==5||j.fixtures.some(f=>!uuid(f.id)||f.state!=='deleted'||!['project','category','stage','image'].includes(f.kind)))throw Error('Exact completed construction journal required');
const projects=j.fixtures.filter(f=>f.kind==='project'),category=j.fixtures.filter(f=>f.kind==='category'),stage=j.fixtures.filter(f=>f.kind==='stage'),image=j.fixtures.filter(f=>f.kind==='image');
if(projects.length!==2||category.length!==1||stage.length!==1||image.length!==1||projects.some(f=>!f.slug.startsWith(j.prefix+'-'))||category[0].slug!==j.prefix+'-category'||!projects.some(f=>f.id===stage[0].parent&&f.id===image[0].parent)||new Set(j.fixtures.map(f=>f.id)).size!==5)throw Error('Fixture provenance guard failed');
const quote=s=>"'"+s.replaceAll("'","''")+"'",ids=projects.map(f=>quote(f.id)).join(','),all=j.fixtures.map(f=>quote(f.id)).join(',');
const query=`BEGIN TRANSACTION READ ONLY;SET LOCAL statement_timeout='15s';
WITH operations AS(SELECT * FROM public.project_media_operations WHERE bound_project_id IN(${ids})),checks(name,pass) AS(
 SELECT 'exact original administrator remains active',EXISTS(SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=${quote(j.actor)} AND p.account_status='active' AND r.name='administrator')
 UNION ALL SELECT 'exact projects absent',NOT EXISTS(SELECT 1 FROM public.projects WHERE id IN(${ids}) OR slug IN(${projects.map(f=>quote(f.slug))}))
 UNION ALL SELECT 'exact category absent',NOT EXISTS(SELECT 1 FROM public.project_categories WHERE id=${quote(category[0].id)} OR slug=${quote(category[0].slug)})
 UNION ALL SELECT 'exact stages absent',NOT EXISTS(SELECT 1 FROM public.project_stages WHERE id=${quote(stage[0].id)} OR project_id IN(${ids}))
 UNION ALL SELECT 'exact images absent',NOT EXISTS(SELECT 1 FROM public.project_images WHERE id=${quote(image[0].id)} OR project_id IN(${ids}))
 UNION ALL SELECT 'exact service links absent',NOT EXISTS(SELECT 1 FROM public.project_services WHERE project_id IN(${ids}))
 UNION ALL SELECT 'exact project objects absent',NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='project-images' AND split_part(name,'/',1) IN(${ids}))
 UNION ALL SELECT 'one terminal operation retained',(SELECT count(*)=1 AND bool_and(state='deleted' AND project_id IS NULL AND actor_id=${quote(j.actor)} AND media_id=${quote(image[0].id)} AND version=4 AND request_version=5) FROM operations)
 UNION ALL SELECT 'retained generated path and hash proof',NOT EXISTS(SELECT 1 FROM operations WHERE bucket_id<>'project-images' OR storage_path NOT LIKE bound_project_id||'/%' OR mime<>'image/png' OR file_size NOT BETWEEN 1 AND 3145728 OR sha256 !~ '^[a-f0-9]{64}$' OR input->>'phase'<>'before')
 UNION ALL SELECT 'root creation and deletion audited',(SELECT count(*)=4 FROM public.audit_logs WHERE entity_id IN(${ids}) AND action IN('project_project_create','project_project_delete') AND actor_id=${quote(j.actor)})
 UNION ALL SELECT 'category creation and deletion audited',(SELECT count(*)=2 FROM public.audit_logs WHERE entity_id=${quote(category[0].id)} AND action IN('project_category_create','project_category_delete') AND actor_id=${quote(j.actor)})
 UNION ALL SELECT 'ordered lifecycle retained',(SELECT array_agg(metadata->'after'->>'status' ORDER BY created_at,id)=ARRAY['ongoing','completed','archived'] FROM public.audit_logs WHERE entity_id=${quote(image[0].parent)} AND action='project_status_update' AND actor_id=${quote(j.actor)})
 UNION ALL SELECT 'file operation audit transitions retained',(SELECT count(*)=4 FROM public.audit_logs WHERE entity_id IN(SELECT id FROM operations) AND action IN('project_media_reserved','project_media_finalize','project_media_delete','project_media_complete') AND actor_id=${quote(j.actor)})
 UNION ALL SELECT 'no foreign audit actor',NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id IN(${all}) AND actor_id IS DISTINCT FROM ${quote(j.actor)}::uuid)
 UNION ALL SELECT 'deleted project snapshot retains stage',EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=${quote(image[0].parent)} AND action='project_project_delete' AND metadata->'before'->'stages' @> jsonb_build_array(jsonb_build_object('id',${quote(stage[0].id)})))
) SELECT jsonb_build_object('all_passed',bool_and(pass),'checks',jsonb_object_agg(name,pass),'retained_operation_count',(SELECT count(*) FROM operations),'retained_audit_count',(SELECT count(*) FROM public.audit_logs WHERE entity_id IN(${all}) OR entity_id IN(SELECT id FROM operations))) evidence FROM checks;
COMMIT;
`;
fs.mkdirSync('.next/module7-release',{recursive:true});fs.writeFileSync('.next/module7-release/05-independent-fixture-verification.sql',query);console.log('Private read-only construction verification query prepared; no database connection made.');
