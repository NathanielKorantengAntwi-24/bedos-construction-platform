// Runs exact release wrappers and refusal probes only inside a guarded local rollback.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const c='supabase_db_bedos-supabase-lab',info=JSON.parse(execFileSync('docker',['inspect',c],{encoding:'utf8',windowsHide:true}))[0];
if(info.Name!=='/'+c||!info.Config.Image.includes('supabase/postgres')||!info.State.Running)throw Error('Local database guard');
const sql=input=>execFileSync('docker',['exec','-i',c,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
const strip=s=>s.replace(/^BEGIN;\r?$/gm,'').replace(/^COMMIT;\r?$/gm,''),quote=s=>"'"+s.replaceAll("'","''")+"'";
const read=fs.readFileSync('scripts/MODULE_7_READONLY_REVIEW.sql','utf8'),before=sql(read);
execFileSync(process.execPath,['scripts/Prepare-Module7Release.mjs'],{encoding:'utf8',windowsHide:true});
const snapshot=JSON.parse(fs.readFileSync('docs/module-7-evidence/production-readonly-review.json','utf8')),sections=Object.fromEntries(snapshot.sections.map(s=>[s.section,s.evidence]));
const phase1=strip(fs.readFileSync('.next/module7-release/01-secure_construction_projects.sql','utf8')),phase2=strip(fs.readFileSync('.next/module7-release/02-restrict_construction_project_access.sql','utf8'));
const expectFailure=(source,message)=>`DO $probe$ BEGIN BEGIN EXECUTE $test_source$${source}$test_source$;RAISE EXCEPTION 'Expected release refusal missing';EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>${quote(message)} THEN RAISE;END IF;END;END;$probe$;`;
const seedPolicies=sections.storage_policies.map(p=>`CREATE POLICY "${p.policyname.replaceAll('"','""')}" ON storage.objects AS ${p.policyname==='bedos_property_storage_backend_only'?'RESTRICTIVE':'PERMISSIVE'} FOR ${p.cmd} TO ${p.roles.map(r=>'"'+r+'"').join(',')}${p.qual?' USING('+p.qual+')':''}${p.with_check?' WITH CHECK('+p.with_check+')':''};`).join('\n');
try{
 const out=sql(`BEGIN;SET LOCAL statement_timeout='60s';SET LOCAL lock_timeout='5s';
 ${strip(fs.readFileSync('supabase/migrations/20261101040000_secure_service_catalog.sql','utf8'))}
 INSERT INTO storage.buckets(id,name,public) VALUES('project-images','project-images',false);
 INSERT INTO public.permissions(name) VALUES('projects.view'),('projects.manage') ON CONFLICT(name) DO NOTHING;
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE (r.name IN('administrator','content_manager') AND p.name IN('projects.view','projects.manage')) OR(r.name='customer' AND p.name='projects.view') ON CONFLICT DO NOTHING;
 ${seedPolicies}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261102020000','local_release_baseline',ARRAY[]::text[]);
 UPDATE storage.buckets SET public=true WHERE id='project-images';
 ${expectFailure(phase1,'Construction production baseline drift')}
 UPDATE storage.buckets SET public=false WHERE id='project-images';
 INSERT INTO public.projects(title,slug) VALUES('Guard','module7-release-guard');
 ${expectFailure(phase1,'Construction production baseline drift')}
 DELETE FROM public.projects WHERE slug='module7-release-guard';
 ${phase1}
 ${expectFailure(phase1,'Unexpected release migration baseline')}
 CREATE TEMP TABLE m7_guard(id uuid);INSERT INTO m7_guard SELECT gen_random_uuid();
 INSERT INTO public.projects(id,title,slug) SELECT id,'Guard','module7-release-guard' FROM m7_guard;
 INSERT INTO public.project_images(project_id,storage_path,phase) SELECT id,id||'/untracked.png','before' FROM m7_guard;
 ${expectFailure(phase2,'Untracked project image')}
 DELETE FROM public.project_images WHERE project_id=(SELECT id FROM m7_guard);DELETE FROM public.projects WHERE id=(SELECT id FROM m7_guard);
 INSERT INTO storage.objects(bucket_id,name) VALUES('project-images','module7-release-guard.png');
 ${expectFailure(phase2,'Untracked project object')}
 -- The object exists only in this rollback transaction; use a savepoint rollback, not a forbidden Storage table delete.
 ROLLBACK;`);
 // Second transaction proves the successful wrappers and production-safe business assertions.
 const good=sql(`BEGIN;SET LOCAL statement_timeout='60s';
 ${strip(fs.readFileSync('supabase/migrations/20261101040000_secure_service_catalog.sql','utf8'))}
 INSERT INTO storage.buckets(id,name,public) VALUES('project-images','project-images',false);
 INSERT INTO public.permissions(name) VALUES('projects.view'),('projects.manage') ON CONFLICT(name) DO NOTHING;
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE (r.name IN('administrator','content_manager') AND p.name IN('projects.view','projects.manage')) OR(r.name='customer' AND p.name='projects.view') ON CONFLICT DO NOTHING;
 ${seedPolicies}
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261102020000','local_release_baseline',ARRAY[]::text[]);
 ${phase1}\n${phase2}
 ${fs.readFileSync('scripts/sql/Test-Module7Projects.sql','utf8')}
 SELECT jsonb_build_object('migration_rows',count(*)) FROM supabase_migrations.schema_migrations WHERE version IN('20261102030000','20261102040000');ROLLBACK;`);
 const report=Object.assign({},...good.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)));
 const restored=before===sql(read);if(!restored)throw Error('Local metadata not restored after rollback');
 const evidence={date:new Date().toISOString(),scope:'Exact production release wrappers executed only in local rollback transactions',refusal_checks:5,local_metadata_restored:restored,...report};
 fs.writeFileSync('docs/module-7-evidence/local-release-sql.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({refusal_checks:5,assertions:report.assertions,migration_rows:report.migration_rows,restored}));
}catch(e){console.error(e.stderr?.toString().slice(-2000)||e.message);process.exitCode=1;}
