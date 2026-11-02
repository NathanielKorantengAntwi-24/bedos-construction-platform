// Exact reviewed release wrappers and refusal guards, LOCAL ONLY; every write rolls back.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const container='supabase_db_bedos-supabase-lab';const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8',windowsHide:true}))[0];if(info.Name!=='/'+container||!info.State.Running||!info.Config.Image.includes('supabase/postgres'))throw Error('Local database guard');
const sql=input=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
const originalInput=fs.readFileSync('docs/MODULE_6_CATALOG_PREFLIGHT.sql','utf8');const state=()=>JSON.parse(sql(originalInput).split('\n').find(l=>l.startsWith('{'))),before=state();
if(sql("SELECT (to_regclass('public.viewing_notification_events') IS NOT NULL)::text;").trim()!=='false')throw Error('Existing Module 6 lab state');
execFileSync(process.execPath,['scripts/Prepare-Module6Release.mjs'],{encoding:'utf8',windowsHide:true});
const strip=s=>s.replace(/^BEGIN;\r?$/gm,'').replace(/^COMMIT;\r?$/gm,'');const migration=n=>strip(fs.readFileSync('supabase/migrations/'+n,'utf8'));
const read=n=>fs.readFileSync('.next/module6-release/'+n,'utf8');
const phase1=read('01-secure_property_viewings.sql'),phase2=read('02-restrict_property_viewing_writes.sql');
if(!/^BEGIN;\r?$/m.test(phase1)||!/^COMMIT;\r?$/m.test(phase1)||!/^BEGIN;\r?$/m.test(phase2)||!/^COMMIT;\r?$/m.test(phase2))throw Error('Wrapper transaction boundaries must remain independently reviewable');
const guard=(body,message)=>`DO $probe$ BEGIN BEGIN EXECUTE $source_guard$${body}$source_guard$;RAISE EXCEPTION 'Expected release refusal missing';EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>${"'"+message.replaceAll("'","''")+"'"} THEN RAISE;END IF;END;END;$probe$;`;
try{
 const output=sql(`BEGIN;
 ${migration('20261101040000_secure_service_catalog.sql')}
 ${migration('20261101060000_secure_property_management.sql')}
 CREATE TEMP TABLE m6_guard_identity(actor uuid,customer uuid,property uuid,viewing uuid);
 INSERT INTO m6_guard_identity VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),NULL);
 INSERT INTO auth.users(id,email,raw_user_meta_data) SELECT id,id||'@bedos-viewing-guard.invalid','{}'::jsonb FROM(SELECT actor id FROM m6_guard_identity UNION SELECT customer FROM m6_guard_identity) q;
 UPDATE public.profiles SET account_status='active',role_id=(SELECT id FROM public.roles WHERE name='administrator') WHERE id=(SELECT actor FROM m6_guard_identity);
 UPDATE public.profiles SET account_status='active',role_id=(SELECT id FROM public.roles WHERE name='customer') WHERE id=(SELECT customer FROM m6_guard_identity);
 INSERT INTO public.permissions(name) VALUES('viewings.view'),('viewings.manage') ON CONFLICT(name) DO NOTHING;
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.name='administrator' AND p.name IN('viewings.view','viewings.manage') ON CONFLICT DO NOTHING;
 INSERT INTO public.properties(id,title,slug,property_type,listing_type,status,created_by) SELECT property,'Local release guard','guard-'||property,'test','test','published',actor FROM m6_guard_identity;
 INSERT INTO public.viewing_requests(property_id,customer_id) SELECT property,customer FROM m6_guard_identity;
 ${guard(migration('20261102010000_secure_property_viewings.sql'),'Existing viewings require explicit provenance review before this zero-baseline release')}
 DELETE FROM public.viewing_requests WHERE property_id=(SELECT property FROM m6_guard_identity);
 INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20261101090000','local_m6_release_baseline',ARRAY[]::text[]);
 ${strip(phase1)}
 INSERT INTO public.viewing_requests(property_id,customer_id) SELECT property,customer FROM m6_guard_identity;
 ${guard(migration('20261102020000_restrict_property_viewing_writes.sql'),'Untracked viewings appeared during cutover; explicit provenance review required')}
 DELETE FROM public.viewing_requests WHERE property_id=(SELECT property FROM m6_guard_identity);
 UPDATE m6_guard_identity SET viewing=(public.bedos_mutate_viewing(customer,'create',property)->'record'->>'id')::uuid;
 UPDATE public.viewing_requests SET status='in_progress' WHERE id=(SELECT viewing FROM m6_guard_identity);
 ${guard(migration('20261102020000_restrict_property_viewing_writes.sql'),'Legacy viewing states require explicit provenance review')}
 DELETE FROM public.viewing_notification_events WHERE viewing_id=(SELECT viewing FROM m6_guard_identity);
 DELETE FROM public.audit_logs WHERE entity_id=(SELECT viewing FROM m6_guard_identity);
 DELETE FROM public.viewing_requests WHERE property_id=(SELECT property FROM m6_guard_identity);
 ${strip(phase2)}
 SELECT jsonb_build_object('metadata',(SELECT jsonb_object_agg(check_name,value) FROM(${read('04-metadata-verification.sql').trim().replace(/;$/,'')}) m),'compatibility_guards',3);
 ${strip(read('03-rollback-verification.sql'))}
 `);
 const report=JSON.parse(output.split('\n').find(l=>l.startsWith('{"metadata"')||l.startsWith('{"compatibility_guards"')));
 const expected={function_count:'9',function_mismatches:'0',direct_table_writes:'0',direct_column_writes:'0',queue_privileges:'0',rls_tables:'2',version_column:'1',version_trigger:'1',canonical_status_constraint:'1',active_read_guard:'1',notification_dedup_index:'1',existing_policies_unchanged:'true',notification_grants_unchanged:'true',original_notification_indexes_unchanged:'true',publication_helper_unchanged:'1',publication_guards:'2',migration_rows:'2',rollback_auth_fixtures:'0',rollback_failure_triggers:'0'};
 if(!Object.entries(expected).every(([k,v])=>report.metadata[k]===v)||Object.keys(report.metadata).length!==Object.keys(expected).length)throw Error('Release metadata mismatch');
 if(JSON.stringify(state())!==JSON.stringify(before))throw Error('Local catalog restoration mismatch');
 const result={date:new Date().toISOString(),scope:'Exact staged release wrappers executed only in one local rollback transaction; pre-existing/untracked/legacy viewing refusal tested',rollback_assertions:139,compatibility_guards:report.compatibility_guards,metadata:report.metadata,restored:true};fs.writeFileSync('docs/module-6-evidence/local-release-wrapper-verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(e){console.error(e.stderr?.toString().slice(-1600)||e.message);process.exitCode=1;}
