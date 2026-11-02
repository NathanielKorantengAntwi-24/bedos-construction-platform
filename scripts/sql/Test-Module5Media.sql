CREATE TEMP TABLE media_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.media_check(n text,ok boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Media check failed: %',n;END IF;INSERT INTO media_checks VALUES(n);END;$$;
CREATE FUNCTION pg_temp.media_error(n text,s text,c text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE failed boolean:=false;BEGIN BEGIN EXECUTE s;EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>c THEN RAISE;END IF;failed:=true;END;IF NOT failed THEN RAISE EXCEPTION 'Expected media error missing: %',n;END IF;INSERT INTO media_checks VALUES(n);END;$$;
CREATE FUNCTION pg_temp.media_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action=current_setting('bedos.media_fail_action',true) THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;
CREATE TRIGGER bedos_media_test_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.media_audit_fail();
DO $test$
DECLARE actor uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();inactive uuid:=gen_random_uuid();property uuid;second_property uuid;
 op jsonb;op2 jsonb;pending_op jsonb;v jsonb;image jsonb;image2 jsonb;child_id uuid;r text;t text;p text;kind text;i integer;n bigint;before_value jsonb;allowed boolean;
BEGIN
 INSERT INTO public.permissions(name) VALUES('properties.manage') ON CONFLICT(name) DO NOTHING;
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.name IN ('administrator','content_manager') AND p.name='properties.manage' ON CONFLICT DO NOTHING;
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(actor,actor||'@bedos-media-test.invalid','{}'),(staff,staff||'@bedos-media-test.invalid','{}'),(customer,customer||'@bedos-media-test.invalid','{}'),(inactive,inactive||'@bedos-media-test.invalid','{}');
 UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name='administrator'),account_status='active' WHERE id=actor;
 UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name='content_manager'),account_status='active' WHERE id=staff;
 UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name='customer'),account_status='active' WHERE id=customer;
 UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name='content_manager'),account_status='suspended' WHERE id=inactive;
 INSERT INTO public.properties(title,slug,property_type,listing_type,status,created_by) VALUES('Local media test','media-'||actor,'test','test','draft',actor) RETURNING properties.id INTO property;
 INSERT INTO public.properties(title,slug,property_type,listing_type,status,created_by) VALUES('Second local media test','media-second-'||actor,'test','test','draft',actor) RETURNING properties.id INTO second_property;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH t IN ARRAY ARRAY['property_images','property_floor_plans','property_features','property_amenities'] LOOP
   FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP PERFORM pg_temp.media_check(r||t||p,NOT has_table_privilege(r,'public.'||t,p));END LOOP;
  END LOOP;
  PERFORM pg_temp.media_check(r||' ledger private',NOT has_table_privilege(r,'public.property_media_operations','SELECT'));
  PERFORM pg_temp.media_check(r||' upload RPC ACL',has_function_privilege(r,'public.bedos_media_upload(uuid,uuid,text,jsonb,text,integer,text,uuid)','EXECUTE')=(r='service_role'));
 END LOOP;
 PERFORM pg_temp.media_error('anonymous draft gallery',format('SELECT public.bedos_media_read(NULL,%L,''images'')',property),'P0002');
 PERFORM pg_temp.media_error('customer preview',format('SELECT public.bedos_media_read(%L,%L,''images'')',customer,property),'42501');
 PERFORM pg_temp.media_error('suspended upload',format('SELECT public.bedos_media_upload(%L,%L,''images'',''{}'',''image/png'',100,%L,%L)',inactive,property,repeat('a',64),gen_random_uuid()),'42501');
 v:=public.bedos_media_read(staff,property,'images');PERFORM pg_temp.media_check('staff draft gallery',v->'records'='[]'::jsonb);
 FOREACH kind IN ARRAY ARRAY['features','amenities'] LOOP
  v:=public.bedos_media_metadata(staff,property,kind,'create',NULL,'{"name":" Example "}');child_id:=(v->>'id')::uuid;
  PERFORM pg_temp.media_check(kind||' create trim',v->>'name'='Example');
  PERFORM pg_temp.media_error(kind||' cross parent edit',format('SELECT public.bedos_media_metadata(%L,%L,%L,''update'',%L,''{"name":"Other"}'')',staff,second_property,kind,child_id),'P0002');
  PERFORM pg_temp.media_error(kind||' ordinary delete denied',format('SELECT public.bedos_media_metadata(%L,%L,%L,''delete'',%L,''{}'')',staff,property,kind,child_id),'42501');
  v:=public.bedos_media_metadata(actor,property,kind,'update',child_id,'{"name":"Changed"}');
  PERFORM pg_temp.media_check(kind||' partial edit',v->>'name'='Changed');
  PERFORM public.bedos_media_metadata(actor,property,kind,'delete',child_id,'{}');
 END LOOP;
 FOR i IN 1..6 LOOP
  v:=CASE i WHEN 1 THEN '[]'::jsonb WHEN 2 THEN '{"name":null}'::jsonb WHEN 3 THEN '{"name":" "}'::jsonb WHEN 4 THEN '{"name":"x","other":1}'::jsonb WHEN 5 THEN '{"value":false}'::jsonb ELSE '{}'::jsonb END;
  PERFORM pg_temp.media_error('invalid metadata '||i,format('SELECT public.bedos_media_metadata(%L,%L,''features'',''create'',NULL,%L)',actor,property,v),'22023');
 END LOOP;
 op:=public.bedos_media_upload(staff,property,'images','{"is_primary":true}','image/png',100,repeat('a',64),gen_random_uuid())->'operation';
 PERFORM pg_temp.media_check('generated immutable property path',op->>'storage_path'='properties/'||property||'/'||(op->>'id')||'.png');
 PERFORM pg_temp.media_check('upload hidden before finalize',public.bedos_media_read(staff,property,'images')->'pagination'->>'total'='0');
 v:=public.bedos_media_upload(staff,property,'images','{"is_primary":true}','image/png',100,repeat('a',64),(op->>'idempotency_key')::uuid);
 PERFORM pg_temp.media_check('idempotent upload not reacquired',v->>'acquired'='false' AND v->'operation'->>'id'=op->>'id');
 PERFORM pg_temp.media_error('idempotency conflict',format('SELECT public.bedos_media_upload(%L,%L,''images'',''{}'',''image/png'',101,%L,%L)',staff,property,repeat('a',64),op->>'idempotency_key'),'P0001');
 PERFORM set_config('bedos.media_fail_action','property_image_created',true);
 PERFORM pg_temp.media_error('audit failure rolls back finalize',format('SELECT public.bedos_media_finalize(%L,%L,%s,%L)',staff,op->>'id',op->>'version',op->>'lease_token'),'23514');
 PERFORM pg_temp.media_check('failed finalize retains pending state',(SELECT state='upload_pending' FROM public.property_media_operations WHERE property_media_operations.id=(op->>'id')::uuid));
 PERFORM set_config('bedos.media_fail_action','',true);
 image:=public.bedos_media_finalize(staff,(op->>'id')::uuid,(op->>'version')::integer,(op->>'lease_token')::uuid);
 PERFORM pg_temp.media_check('finalize ready and private path omitted',image->>'is_primary'='true' AND NOT image ? 'storage_path');
 op2:=public.bedos_media_upload(staff,property,'images','{"is_primary":true}','image/jpeg',101,repeat('b',64),gen_random_uuid())->'operation';
 image2:=public.bedos_media_finalize(staff,(op2->>'id')::uuid,(op2->>'version')::integer,(op2->>'lease_token')::uuid);
 PERFORM pg_temp.media_check('primary replacement serialized',(SELECT count(*)=1 FROM public.property_images WHERE property_id=property AND is_primary) AND (SELECT NOT is_primary FROM public.property_images WHERE property_images.id=(image->>'id')::uuid));
 v:=public.bedos_media_metadata(staff,property,'images','update',(image->>'id')::uuid,'{"is_primary":true,"display_order":2}');
 PERFORM pg_temp.media_check('primary edit clears previous',(SELECT count(*)=1 FROM public.property_images WHERE property_id=property AND is_primary) AND v->>'is_primary'='true');
 PERFORM pg_temp.media_error('manager cannot delete file',format('SELECT public.bedos_media_operation(%L,''delete'',NULL,%L,%L,''images'')',staff,property,image->>'id'),'42501');
 UPDATE public.properties SET status='published' WHERE properties.id=property;
 v:=public.bedos_media_read(NULL,property,'images');PERFORM pg_temp.media_check('public published gallery ready',v->'pagination'->>'total'='2' AND NOT (v->'records'->0) ? 'storage_path');
 v:=public.bedos_media_read(NULL,property,'images',(image->>'id')::uuid,1,25,true);PERFORM pg_temp.media_check('file read private proof available only through service RPC',v->>'sha256'=repeat('a',64));
 v:=public.bedos_media_operation(actor,'delete',NULL,property,(image->>'id')::uuid,'images');
 PERFORM pg_temp.media_check('delete request acquires lease',v->>'acquired'='true');op:=v->'operation';
 PERFORM pg_temp.media_check('cleanup hides asset but retains metadata',public.bedos_media_read(NULL,property,'images')->'pagination'->>'total'='1' AND EXISTS(SELECT 1 FROM public.property_images WHERE property_images.id=(image->>'id')::uuid));
 PERFORM pg_temp.media_error('parent remains protected',format('SELECT public.bedos_mutate_property(%L,''delete'',%L,''{}'')',actor,property),'P0001');
 PERFORM pg_temp.media_error('active cleanup cannot retry',format('SELECT public.bedos_media_operation(%L,''retry'',%L)',actor,op->>'id'),'P0001');
 PERFORM pg_temp.media_error('stale cleanup completion',format('SELECT public.bedos_media_operation(%L,''complete'',%L,NULL,NULL,NULL,0,%L)',actor,op->>'id',op->>'lease_token'),'P0001');
 PERFORM public.bedos_media_operation(actor,'complete',(op->>'id')::uuid,NULL,NULL,NULL,(op->>'version')::integer,(op->>'lease_token')::uuid);
 PERFORM pg_temp.media_check('completed deletion removes metadata',NOT EXISTS(SELECT 1 FROM public.property_images WHERE property_images.id=(image->>'id')::uuid));
 pending_op:=public.bedos_media_upload(staff,second_property,'floor_plans','{}','image/webp',99,repeat('c',64),gen_random_uuid())->'operation';
 PERFORM pg_temp.media_error('active upload cannot be cleaned',format('SELECT public.bedos_media_operation(%L,''retry'',%L)',actor,pending_op->>'id'),'P0001');
 PERFORM public.bedos_mutate_property(actor,'delete',second_property,'{}');
 PERFORM pg_temp.media_check('orphan operation survives parent deletion',(SELECT property_id IS NULL AND state='cleanup_pending' FROM public.property_media_operations WHERE property_media_operations.id=(pending_op->>'id')::uuid));
 UPDATE public.property_media_operations SET lease_until=now()-interval '1 minute' WHERE property_media_operations.id=(pending_op->>'id')::uuid;
 v:=public.bedos_media_operation(actor,'retry',(pending_op->>'id')::uuid);PERFORM pg_temp.media_check('expired orphan cleanup can be claimed',v->>'acquired'='true');
 pending_op:=v->'operation';
 PERFORM public.bedos_media_operation(actor,'complete',(pending_op->>'id')::uuid,NULL,NULL,NULL,(pending_op->>'version')::integer,(pending_op->>'lease_token')::uuid);
 PERFORM pg_temp.media_check('orphan cleanup recorded deleted',(SELECT state='deleted' FROM public.property_media_operations WHERE property_media_operations.id=(pending_op->>'id')::uuid));
 -- Quotas and revocation must hold at the database boundary, not only in handlers.
 pending_op:=public.bedos_media_upload(staff,property,'images','{}','image/png',99,repeat('d',64),gen_random_uuid())->'operation';
 UPDATE public.profiles SET account_status='suspended' WHERE id=staff;
 PERFORM pg_temp.media_error('revoked actor cannot finalize',format('SELECT public.bedos_media_finalize(%L,%L,%s,%L)',staff,pending_op->>'id',pending_op->>'version',pending_op->>'lease_token'),'42501');
 UPDATE public.profiles SET account_status='active' WHERE id=staff;
 UPDATE public.property_media_operations SET lease_until=now()-interval '1 minute' WHERE property_media_operations.id=(pending_op->>'id')::uuid;
 v:=public.bedos_media_operation(actor,'retry',(pending_op->>'id')::uuid);pending_op:=v->'operation';
 PERFORM public.bedos_media_operation(actor,'complete',(pending_op->>'id')::uuid,NULL,NULL,NULL,(pending_op->>'version')::integer,(pending_op->>'lease_token')::uuid);
 UPDATE public.profiles SET account_status='active' WHERE id=inactive;
 FOR i IN 1..2 LOOP PERFORM public.bedos_media_upload(inactive,property,'images','{}','image/png',99,repeat('e',64),gen_random_uuid());END LOOP;
 PERFORM pg_temp.media_error('inflight upload limit',format('SELECT public.bedos_media_upload(%L,%L,''images'',''{}'',''image/png'',99,%L,%L)',inactive,property,repeat('e',64),gen_random_uuid()),'P0001');
 UPDATE public.property_media_operations SET state='deleted' WHERE actor_id=inactive;
 INSERT INTO public.property_media_operations(property_id,bound_property_id,actor_id,kind,idempotency_key,bucket_id,storage_path,mime,file_size,sha256,input,state)
 SELECT property,property,inactive,'images',gen_random_uuid(),'property-images','rate-fixture/'||gen_random_uuid(),'image/png',99,repeat('e',64),'{}','deleted' FROM generate_series(1,28);
 PERFORM pg_temp.media_error('per actor upload rate limit',format('SELECT public.bedos_media_upload(%L,%L,''images'',''{}'',''image/png'',99,%L,%L)',inactive,property,repeat('e',64),gen_random_uuid()),'P0429');
 INSERT INTO public.property_floor_plans(property_id,storage_path) SELECT property,'quota-test/'||gen_random_uuid() FROM generate_series(1,25);
 PERFORM pg_temp.media_error('floor plan quota',format('SELECT public.bedos_media_upload(%L,%L,''floor_plans'',''{}'',''image/png'',99,%L,%L)',staff,property,repeat('e',64),gen_random_uuid()),'P0001');
 INSERT INTO public.property_features(property_id,name) SELECT property,'Quota fixture' FROM generate_series(1,100);
 PERFORM pg_temp.media_error('feature quota',format('SELECT public.bedos_media_metadata(%L,%L,''features'',''create'',NULL,''{"name":"Excess"}'')',staff,property),'P0001');
 -- BEGIN LOCAL STORAGE CATALOG PROBES (omit from production rollback verification)
 INSERT INTO storage.objects(bucket_id,name) VALUES('property-images','test-private.png'),('property-floor-plans','test-private.png'),('bedos-unrelated-sql-test','test-unrelated.png');
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO n FROM storage.objects WHERE bucket_id IN ('property-images','property-floor-plans');
 RESET ROLE;PERFORM pg_temp.media_check('restrictive policy blocks direct property listing',n=0);
 SET LOCAL ROLE authenticated;SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='bedos-unrelated-sql-test';RESET ROLE;
 PERFORM pg_temp.media_check('unrelated permissive bucket unaffected',n=1);
 -- END LOCAL STORAGE CATALOG PROBES
END;$test$;
