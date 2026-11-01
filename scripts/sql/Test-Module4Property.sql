CREATE TEMP TABLE property_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.check_property(n text,ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Property check failed: %',n;END IF;INSERT INTO property_checks VALUES(n);END;$$;
CREATE FUNCTION pg_temp.property_error(n text,statement text,code text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE failed boolean:=false;BEGIN
  BEGIN EXECUTE statement;EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>code THEN RAISE;END IF;failed:=true;END;
  IF NOT failed THEN RAISE EXCEPTION 'Missing expected property error: %',n;END IF;
  INSERT INTO property_checks VALUES(n);
END;$$;
CREATE FUNCTION pg_temp.property_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.action=current_setting('bedos.property_fail_action',true) THEN RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;
CREATE TRIGGER bedos_property_test_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.property_audit_failure();
DO $test$
DECLARE actor uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); inactive uuid:=gen_random_uuid();
  record_id uuid; extra_id uuid; dependency_id uuid; enquiry_id uuid; input jsonb; v jsonb; prior jsonb;
  role_name text; privilege_name text; source_status text; target_status text; allowed boolean; i integer; count_before bigint;
  statuses text[]:=ARRAY['draft','published','reserved','sold','unavailable','archived'];
BEGIN
  INSERT INTO public.roles(name) VALUES('administrator'),('content_manager'),('customer'),('finance') ON CONFLICT(name) DO NOTHING;
  INSERT INTO public.permissions(name) VALUES('properties.manage'),('properties.view') ON CONFLICT(name) DO NOTHING;
  INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
    WHERE r.name IN ('administrator','content_manager') AND p.name IN ('properties.manage','properties.view') ON CONFLICT DO NOTHING;
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(actor,actor||'@property-test.invalid','{}'),(staff,staff||'@property-test.invalid','{}'),(customer,customer||'@property-test.invalid','{}'),(inactive,inactive||'@property-test.invalid','{}');
  UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name='administrator'),account_status='active' WHERE id=actor;
  UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name='content_manager'),account_status='active' WHERE id=staff;
  UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name='customer'),account_status='active' WHERE id=customer;
  UPDATE public.profiles SET role_id=(SELECT id FROM public.roles WHERE name='content_manager'),account_status='suspended' WHERE id=inactive;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      PERFORM pg_temp.check_property(role_name||' denied '||privilege_name,NOT has_table_privilege(role_name,'public.properties',privilege_name));
    END LOOP;
    PERFORM pg_temp.check_property(role_name||' mutation ACL',has_function_privilege(role_name,'public.bedos_mutate_property(uuid,text,uuid,jsonb)','EXECUTE')=(role_name='service_role'));
    PERFORM pg_temp.check_property(role_name||' read ACL',has_function_privilege(role_name,'public.bedos_read_properties(uuid,uuid,jsonb)','EXECUTE')=(role_name='service_role'));
    PERFORM pg_temp.check_property(role_name||' validator private',NOT has_function_privilege(role_name,'public.bedos_validate_property_input(jsonb,boolean)','EXECUTE'));
  END LOOP;
  input:=jsonb_build_object('title','Test %,(literal)','slug','property-'||actor,'property_type','house','listing_type','sale','price',250.25,'bedrooms',2,'bathrooms',1,'city','Accra');
  v:=public.bedos_mutate_property(actor,'create',NULL,input);record_id:=(v->>'id')::uuid;
  PERFORM pg_temp.check_property('create draft default and actor',v->>'status'='draft' AND v->>'currency'='GHS' AND v->>'created_by'=actor::text AND v->>'price'='250.25');
  PERFORM pg_temp.check_property('public draft invisible',public.bedos_read_properties(NULL,NULL,'{}')->'pagination'->>'total'='0');
  PERFORM pg_temp.check_property('content preview draft',public.bedos_read_properties(staff,record_id,'{}')->>'id'=record_id::text);
  PERFORM pg_temp.property_error('anonymous draft detail',format('SELECT public.bedos_read_properties(NULL,%L,''{}'')',record_id),'P0002');
  PERFORM pg_temp.property_error('customer preview denied',format('SELECT public.bedos_read_properties(%L,NULL,''{}'')',customer),'42501');
  PERFORM pg_temp.property_error('inactive mutation denied',format('SELECT public.bedos_mutate_property(%L,''update'',%L,''{"title":"x"}'')',inactive,record_id),'42501');
  PERFORM pg_temp.property_error('null actor denied',format('SELECT public.bedos_mutate_property(NULL,''delete'',%L,''{}'')',record_id),'42501');
  PERFORM pg_temp.property_error('customer mutation denied',format('SELECT public.bedos_mutate_property(%L,''delete'',%L,''{}'')',customer,record_id),'42501');
  PERFORM pg_temp.property_error('content delete denied',format('SELECT public.bedos_mutate_property(%L,''delete'',%L,''{}'')',staff,record_id),'42501');
  FOR i IN 1..10 LOOP
    v:=CASE i WHEN 1 THEN 'null'::jsonb WHEN 2 THEN '[]'::jsonb WHEN 3 THEN '{}'::jsonb WHEN 4 THEN '{"title":1}'::jsonb WHEN 5 THEN '{"price":-1}'::jsonb WHEN 6 THEN '{"bedrooms":1.5}'::jsonb WHEN 7 THEN '{"featured":"true"}'::jsonb WHEN 8 THEN '{"currency":"ghs"}'::jsonb WHEN 9 THEN '{"status":"published"}'::jsonb ELSE '{"price":0.001}'::jsonb END;
    PERFORM pg_temp.property_error('invalid edit '||i,format('SELECT public.bedos_mutate_property(%L,''update'',%L,%L)',actor,record_id,v),'22023');
  END LOOP;
  PERFORM pg_temp.property_error('duplicate slug',format('SELECT public.bedos_mutate_property(%L,''create'',NULL,%L)',actor,input),'23505');
  v:=public.bedos_mutate_property(staff,'update',record_id,'{"description":"Updated","featured":true}');
  PERFORM pg_temp.check_property('partial edit preserves fields',v->>'description'='Updated' AND v->>'price'='250.25' AND v->>'status'='draft');
  FOREACH source_status IN ARRAY statuses LOOP
    FOREACH target_status IN ARRAY statuses LOOP
      UPDATE public.properties SET status=source_status WHERE id=record_id;
      allowed:=CASE source_status WHEN 'draft' THEN target_status IN ('published','archived') WHEN 'published' THEN target_status IN ('draft','reserved','sold','unavailable','archived') WHEN 'reserved' THEN target_status IN ('published','sold','unavailable','archived') WHEN 'unavailable' THEN target_status IN ('published','archived') WHEN 'sold' THEN target_status='archived' WHEN 'archived' THEN target_status='draft' ELSE false END;
      input:=jsonb_build_object('status',target_status,'expected_status',source_status,'reason','Lifecycle verification');
      IF allowed THEN
        v:=public.bedos_mutate_property(staff,'status',record_id,input);
        PERFORM pg_temp.check_property(source_status||' -> '||target_status,v->>'status'=target_status);
      ELSE
        PERFORM pg_temp.property_error(source_status||' -> '||target_status,format('SELECT public.bedos_mutate_property(%L,''status'',%L,%L)',staff,record_id,input),'P0001');
      END IF;
    END LOOP;
  END LOOP;
  UPDATE public.properties SET status='published' WHERE id=record_id;
  PERFORM pg_temp.property_error('stale transition rejected',format('SELECT public.bedos_mutate_property(%L,''status'',%L,''{"status":"archived","expected_status":"draft","reason":"Stale"}'')',actor,record_id),'P0001');
  PERFORM pg_temp.property_error('blank reason denied',format('SELECT public.bedos_mutate_property(%L,''status'',%L,''{"status":"archived","expected_status":"published","reason":" "}'')',actor,record_id),'22023');
  v:=public.bedos_read_properties(NULL,record_id,'{}');
  PERFORM pg_temp.check_property('public exact field count and private actor omitted',(SELECT count(*) FROM jsonb_object_keys(v))=20 AND NOT v ? 'created_by');
  v:=public.bedos_read_properties(NULL,NULL,'{"search":"%,(literal)","city":"Accra","property_type":"house","listing_type":"sale","featured":true,"min_price":250,"max_price":251,"min_bedrooms":2,"max_bedrooms":2,"min_bathrooms":1,"max_bathrooms":1}');
  PERFORM pg_temp.check_property('combined filters exact count',v->'pagination'->>'total'='1');
  PERFORM pg_temp.check_property('literal wildcard not broad search',public.bedos_read_properties(NULL,NULL,'{"search":"x%"}')->'pagination'->>'total'='0');
  v:=public.bedos_read_properties(NULL,NULL,'{"page":2,"limit":1}');
  PERFORM pg_temp.check_property('empty page retains count',v->'properties'='[]'::jsonb AND v->'pagination'->>'total'='1' AND v->'pagination'->>'total_pages'='1');
  FOR i IN 1..7 LOOP
    v:=CASE i WHEN 1 THEN '{"page":0}'::jsonb WHEN 2 THEN '{"limit":101}'::jsonb WHEN 3 THEN '{"min_price":2,"max_price":1}'::jsonb WHEN 4 THEN '{"status":"draft"}'::jsonb WHEN 5 THEN '{"search":1}'::jsonb WHEN 6 THEN '{"unknown":true}'::jsonb ELSE '{"min_bedrooms":1.2}'::jsonb END;
    PERFORM pg_temp.property_error('invalid public filters '||i,format('SELECT public.bedos_read_properties(NULL,NULL,%L)',v),'22023');
  END LOOP;
  INSERT INTO public.property_images(property_id,storage_path) VALUES(record_id,'not-a-real-upload') RETURNING id INTO dependency_id;
  PERFORM pg_temp.property_error('image protects deletion',format('SELECT public.bedos_mutate_property(%L,''delete'',%L,''{}'')',actor,record_id),'P0001');
  DELETE FROM public.property_images WHERE id=dependency_id;
  INSERT INTO public.property_floor_plans(property_id,storage_path) VALUES(record_id,'not-a-real-upload') RETURNING id INTO dependency_id;
  PERFORM pg_temp.property_error('floor plan protects deletion',format('SELECT public.bedos_mutate_property(%L,''delete'',%L,''{}'')',actor,record_id),'P0001');
  DELETE FROM public.property_floor_plans WHERE id=dependency_id;
  INSERT INTO public.viewing_requests(property_id,customer_id) VALUES(record_id,customer) RETURNING id INTO dependency_id;
  PERFORM pg_temp.property_error('viewing protects deletion',format('SELECT public.bedos_mutate_property(%L,''delete'',%L,''{}'')',actor,record_id),'P0001');
  UPDATE public.properties SET status='unavailable' WHERE id=record_id;
  PERFORM pg_temp.property_error('withdrawn viewing reference denied',format('INSERT INTO public.viewing_requests(property_id,customer_id) VALUES(%L,%L)',record_id,customer),'P0409');
  PERFORM pg_temp.property_error('withdrawn enquiry reference denied',format('INSERT INTO public.enquiries(enquiry_type,property_id) VALUES(''property_enquiry'',%L)',record_id),'P0409');
  UPDATE public.viewing_requests SET status='contacted' WHERE id=dependency_id;
  PERFORM pg_temp.check_property('existing viewing workflow preserved after withdrawal',(SELECT status='contacted' FROM public.viewing_requests WHERE id=dependency_id));
  UPDATE public.properties SET status='published' WHERE id=record_id;
  DELETE FROM public.viewing_requests WHERE id=dependency_id;
  SELECT count(*) INTO count_before FROM public.audit_logs WHERE entity_id=record_id;
  prior:=public.bedos_read_properties(actor,record_id,'{}');
  PERFORM set_config('bedos.property_fail_action','property_updated',true);
  PERFORM pg_temp.property_error('audit failure aborts update',format('SELECT public.bedos_mutate_property(%L,''update'',%L,''{"title":"Must roll back"}'')',actor,record_id),'23514');
  PERFORM pg_temp.check_property('failed audit preserves record',prior=public.bedos_read_properties(actor,record_id,'{}'));
  PERFORM pg_temp.check_property('failed audit inserts no audit',(SELECT count(*) FROM public.audit_logs WHERE entity_id=record_id)=count_before);
  PERFORM set_config('bedos.property_fail_action','',true);
  INSERT INTO public.property_features(property_id,name,value) VALUES(record_id,'Test feature','yes');
  INSERT INTO public.property_amenities(property_id,name) VALUES(record_id,'Test amenity');
  INSERT INTO public.enquiries(enquiry_type,property_id) VALUES('property_enquiry',record_id) RETURNING id INTO enquiry_id;
  PERFORM set_config('bedos.property_fail_action','property_deleted',true);
  PERFORM pg_temp.property_error('audit failure aborts deletion',format('SELECT public.bedos_mutate_property(%L,''delete'',%L,''{}'')',actor,record_id),'23514');
  PERFORM pg_temp.check_property('deletion rollback preserves dependencies',(SELECT property_id=record_id FROM public.enquiries WHERE id=enquiry_id) AND EXISTS(SELECT 1 FROM public.property_features WHERE property_id=record_id));
  PERFORM set_config('bedos.property_fail_action','',true);
  PERFORM public.bedos_mutate_property(actor,'delete',record_id,'{}');
  PERFORM pg_temp.check_property('deleted property gone',NOT EXISTS(SELECT 1 FROM public.properties WHERE id=record_id));
  PERFORM pg_temp.check_property('metadata cascaded',NOT EXISTS(SELECT 1 FROM public.property_features WHERE property_id=record_id) AND NOT EXISTS(SELECT 1 FROM public.property_amenities WHERE property_id=record_id));
  PERFORM pg_temp.check_property('enquiry detached and audited',(SELECT property_id IS NULL FROM public.enquiries WHERE id=enquiry_id) AND EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=enquiry_id AND action='enquiry_property_detached' AND actor_id=actor));
  PERFORM pg_temp.check_property('deleted metadata audited',EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=record_id AND action='property_deleted' AND jsonb_array_length(metadata->'deleted_metadata'->'features')=1 AND jsonb_array_length(metadata->'deleted_metadata'->'amenities')=1));
  PERFORM pg_temp.check_property('status audits record actor reason and state',NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=record_id AND action='property_status_changed' AND (actor_id<>staff OR metadata->>'reason'<>'Lifecycle verification' OR metadata->'before'->>'status'=metadata->'after'->>'status')));
  PERFORM pg_temp.property_error('missing property not found',format('SELECT public.bedos_mutate_property(%L,''delete'',%L,''{}'')',actor,record_id),'P0002');
END;$test$;
