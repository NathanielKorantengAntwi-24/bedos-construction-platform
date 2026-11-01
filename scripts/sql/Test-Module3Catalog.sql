CREATE TEMP TABLE catalog_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.check_catalog(p_name text,p_pass boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_pass IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Catalog assertion failed: %',p_name;END IF;INSERT INTO catalog_checks VALUES(p_name);END;$$;
CREATE FUNCTION pg_temp.expect_catalog_error(p_name text,p_sql text,p_code text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_failed boolean:=false;
BEGIN
 BEGIN EXECUTE p_sql;EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>p_code THEN RAISE;END IF;v_failed:=true;END;
 IF NOT v_failed THEN RAISE EXCEPTION 'Expected catalog failure missing: %',p_name;END IF;
 INSERT INTO catalog_checks VALUES(p_name);
END;$$;
CREATE FUNCTION pg_temp.catalog_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.action=current_setting('bedos.catalog_fail_action',true) THEN RAISE EXCEPTION 'Synthetic catalog audit failure' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;
CREATE TRIGGER bedos_catalog_test_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.catalog_audit_failure();
DO $test$
DECLARE actor uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();inactive uuid:=gen_random_uuid();missing uuid:=gen_random_uuid();
admin_role uuid;content_role uuid;customer_role uuid;prefix text:='catalog-'||gen_random_uuid();
cat uuid;hidden_cat uuid;empty_cat uuid;s1 uuid;s2 uuid;s3 uuid;s4 uuid;literal_id uuid;enquiry uuid;enquiry2 uuid;legacy uuid;
v jsonb;before_value jsonb;after_value jsonb;entry jsonb;keys text[];count_before bigint;role_name text;table_name text;privilege_name text;denied boolean;statement text;
BEGIN
 INSERT INTO public.roles(name) VALUES('administrator'),('content_manager'),('customer') ON CONFLICT(name) DO NOTHING;
 INSERT INTO public.permissions(name) VALUES('services.view'),('services.manage') ON CONFLICT(name) DO NOTHING;
 SELECT id INTO admin_role FROM public.roles WHERE name='administrator';SELECT id INTO content_role FROM public.roles WHERE name='content_manager';SELECT id INTO customer_role FROM public.roles WHERE name='customer';
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p WHERE r.name IN ('administrator','content_manager') AND p.name IN ('services.view','services.manage') ON CONFLICT DO NOTHING;
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(actor,actor||'@bedos-catalog-test.invalid','{}'),(staff,staff||'@bedos-catalog-test.invalid','{}'),(customer,customer||'@bedos-catalog-test.invalid','{}'),(inactive,inactive||'@bedos-catalog-test.invalid','{}');
 UPDATE public.profiles SET role_id=admin_role,account_status='active' WHERE id=actor;
 UPDATE public.profiles SET role_id=content_role,account_status='active' WHERE id=staff;
 UPDATE public.profiles SET role_id=customer_role,account_status='active' WHERE id=customer;
 UPDATE public.profiles SET role_id=content_role,account_status='suspended' WHERE id=inactive;
 DELETE FROM public.role_permissions WHERE role_id=customer_role AND permission_id IN (SELECT id FROM public.permissions WHERE name IN ('services.view','services.manage'));

 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH table_name IN ARRAY ARRAY['services','service_categories'] LOOP
   FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    PERFORM pg_temp.check_catalog(role_name||' '||table_name||' no '||privilege_name,NOT has_table_privilege(role_name,'public.'||table_name,privilege_name));
   END LOOP;
   FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
    PERFORM pg_temp.check_catalog(role_name||' '||table_name||' no column '||privilege_name,NOT has_any_column_privilege(role_name,'public.'||table_name,privilege_name));
   END LOOP;

  END LOOP;
  PERFORM pg_temp.check_catalog(role_name||' mutation RPC ACL',has_function_privilege(role_name,'public.bedos_mutate_service(uuid,text,uuid,jsonb)','EXECUTE')=(role_name='service_role'));
  PERFORM pg_temp.check_catalog(role_name||' read RPC ACL',has_function_privilege(role_name,'public.bedos_read_service_catalog(uuid,boolean,text,uuid,text,integer,integer,uuid,boolean,text,text)','EXECUTE')=(role_name='service_role'));
  PERFORM pg_temp.check_catalog(role_name||' no direct authorization helper',NOT has_function_privilege(role_name,'public.bedos_require_catalog_permission(uuid,text)','EXECUTE'));
 END LOOP;
 FOR role_name IN SELECT unnest(ARRAY[customer::text,inactive::text,missing::text]) LOOP
  PERFORM pg_temp.expect_catalog_error('actor denied write '||role_name,format('SELECT public.bedos_mutate_service(%L,''create'',NULL,''{"name":"n","slug":"s"}'')',role_name),'42501');
  PERFORM pg_temp.expect_catalog_error('actor denied staff read '||role_name,format('SELECT public.bedos_read_service_catalog(%L)',role_name),'42501');
 END LOOP;
 PERFORM pg_temp.expect_catalog_error('null actor denied', 'SELECT public.bedos_mutate_service(NULL,''create'',NULL,''{}'')','42501');
 v:=public.bedos_mutate_service_category(actor,'create',NULL,jsonb_build_object('name',prefix||' visible','slug',prefix||'-visible'));cat:=(v->>'id')::uuid;
 v:=public.bedos_mutate_service_category(staff,'create',NULL,jsonb_build_object('name',prefix||' hidden','slug',prefix||'-hidden'));hidden_cat:=(v->>'id')::uuid;
 v:=public.bedos_mutate_service_category(actor,'create',NULL,jsonb_build_object('name',prefix||' empty','slug',prefix||'-empty'));empty_cat:=(v->>'id')::uuid;
 PERFORM pg_temp.check_catalog('category creation defaults',v->'description'='null'::jsonb);
 v:=public.bedos_mutate_service(staff,'create',NULL,jsonb_build_object('name',prefix||' draft','slug',prefix||'-draft','category_id',cat));s1:=(v->>'id')::uuid;
 PERFORM pg_temp.check_catalog('service defaults actor and category',v->>'status'='draft' AND v->'featured'='false'::jsonb AND v->>'created_by'=staff::text AND v->>'category_id'=cat::text);
 v:=public.bedos_mutate_service(actor,'create',NULL,jsonb_build_object('name',prefix||' published','slug',prefix||'-published','category_id',cat,'status','published','featured',true));s2:=(v->>'id')::uuid;
 v:=public.bedos_mutate_service(actor,'create',NULL,jsonb_build_object('name',prefix||' archived','slug',prefix||'-archived','category_id',hidden_cat,'status','archived'));s3:=(v->>'id')::uuid;
 v:=public.bedos_mutate_service(actor,'create',NULL,jsonb_build_object('name',prefix||' unclassified','slug',prefix||'-unclassified','status','published'));s4:=(v->>'id')::uuid;
 v:=public.bedos_read_service_catalog(p_actor_id=>staff,p_q=>prefix);
 PERFORM pg_temp.check_catalog('authorized staff sees all publication states',(v->'pagination'->>'total')::int=4 AND jsonb_array_length(v->'services')=4);
 v:=public.bedos_read_service_catalog(p_public=>true,p_q=>prefix);
 PERFORM pg_temp.check_catalog('public sees only published',(v->'pagination'->>'total')::int=2 AND jsonb_array_length(v->'services')=2);
 SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(v->'services'->0) k;
 PERFORM pg_temp.check_catalog('public service fields exact',keys=ARRAY['category_id','description','featured','id','name','slug']);
 v:=public.bedos_read_service_catalog(p_public=>true,p_entity=>'categories',p_q=>prefix);
 PERFORM pg_temp.check_catalog('public hides unused and nonpublished categories',(v->'pagination'->>'total')::int=1 AND v->'categories'->0->>'id'=cat::text);
 SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(v->'categories'->0) k;
 PERFORM pg_temp.check_catalog('public category fields exact',keys=ARRAY['description','id','name','slug']);
 v:=public.bedos_read_service_catalog(p_actor_id=>actor,p_entity=>'categories',p_q=>prefix);
 PERFORM pg_temp.check_catalog('staff category list includes all',(v->'pagination'->>'total')::int=3);
 v:=public.bedos_read_service_catalog(p_public=>true,p_slug=>prefix||'-published');PERFORM pg_temp.check_catalog('public exact slug detail',v->>'id'=s2::text);
 PERFORM pg_temp.expect_catalog_error('public draft slug hidden',format('SELECT public.bedos_read_service_catalog(p_public=>true,p_slug=>%L)',prefix||'-draft'),'P0002');
 PERFORM pg_temp.expect_catalog_error('public archived slug hidden',format('SELECT public.bedos_read_service_catalog(p_public=>true,p_slug=>%L)',prefix||'-archived'),'P0002');
 PERFORM pg_temp.expect_catalog_error('public missing slug',format('SELECT public.bedos_read_service_catalog(p_public=>true,p_slug=>%L)',prefix||'-missing'),'P0002');
 v:=public.bedos_read_service_catalog(p_actor_id=>staff,p_id=>s1);PERFORM pg_temp.check_catalog('staff detail includes draft creator',v->>'id'=s1::text AND v->>'created_by'=staff::text);
 -- Production customers already have services.view. Preserve their existing RLS scope.
 INSERT INTO public.role_permissions(role_id,permission_id) SELECT customer_role,id FROM public.permissions WHERE name='services.view' ON CONFLICT DO NOTHING;
 v:=public.bedos_read_service_catalog(p_actor_id=>customer,p_q=>prefix);
 PERFORM pg_temp.check_catalog('customer view permission still hides drafts and archives',(v->'pagination'->>'total')::int=2 AND jsonb_array_length(v->'services')=2);
 PERFORM pg_temp.expect_catalog_error('customer with view permission cannot guess draft UUID',format('SELECT public.bedos_read_service_catalog(p_actor_id=>%L,p_id=>%L)',customer,s1),'P0002');
 PERFORM pg_temp.expect_catalog_error('customer with view permission cannot select archived content',format('SELECT public.bedos_read_service_catalog(p_actor_id=>%L,p_id=>%L)',customer,s3),'P0002');
 v:=public.bedos_read_service_catalog(p_actor_id=>customer,p_id=>s2);
 PERFORM pg_temp.check_catalog('customer existing published detail remains compatible',v->>'id'=s2::text AND v->>'status'='published');
 v:=public.bedos_read_service_catalog(p_actor_id=>customer,p_entity=>'categories',p_q=>prefix);
 PERFORM pg_temp.check_catalog('customer existing category scope preserved',(v->'pagination'->>'total')::int=3);
 DELETE FROM public.role_permissions WHERE role_id=customer_role AND permission_id IN(SELECT id FROM public.permissions WHERE name='services.view');
 v:=public.bedos_read_service_catalog(p_public=>true,p_q=>prefix,p_featured=>true,p_category_id=>cat);PERFORM pg_temp.check_catalog('combined filters',(v->'pagination'->>'total')::int=1 AND v->'services'->0->>'id'=s2::text);
 v:=public.bedos_read_service_catalog(p_actor_id=>actor,p_q=>prefix,p_status=>'archived');PERFORM pg_temp.check_catalog('staff status filter',(v->'pagination'->>'total')::int=1 AND v->'services'->0->>'id'=s3::text);
 v:=public.bedos_read_service_catalog(p_public=>true,p_q=>prefix,p_page=>3,p_page_size=>1);PERFORM pg_temp.check_catalog('empty page retains count',(v->'pagination'->>'total')::int=2 AND v->'services'='[]'::jsonb);
 v:=public.bedos_read_service_catalog(p_public=>true,p_q=>prefix,p_page_size=>1);before_value:=v->'services'->0;
 v:=public.bedos_read_service_catalog(p_public=>true,p_q=>prefix,p_page=>2,p_page_size=>1);PERFORM pg_temp.check_catalog('stable pages do not overlap',before_value->>'id'<>v->'services'->0->>'id');
 v:=public.bedos_mutate_service(actor,'create',NULL,jsonb_build_object('name',prefix||' literal %_,+()\','slug',prefix||'-literal','status','published'));literal_id:=(v->>'id')::uuid;
 v:=public.bedos_read_service_catalog(p_public=>true,p_q=>prefix||' literal %_,+()\');PERFORM pg_temp.check_catalog('search metacharacters literal',(v->'pagination'->>'total')::int=1 AND v->'services'->0->>'id'=literal_id::text);

 FOR entry IN SELECT value FROM jsonb_array_elements('[null,[],7,"x",{}, {"name":7,"slug":"s"},{"name":"n","slug":false},{"name":"n","slug":"s","description":true},{"name":"n","slug":"s","featured":"false"},{"name":"n","slug":"s","featured":null},{"name":"n","slug":"s","status":null},{"name":"n","slug":"s","status":"hidden"},{"name":"n","slug":"s","category_id":"bad"},{"name":"n","slug":"s","created_by":"forged"}]') LOOP
  PERFORM pg_temp.expect_catalog_error('invalid service JSON '||entry::text,format('SELECT public.bedos_mutate_service(%L,''create'',NULL,%L::jsonb)',actor,entry::text),'22023');
 END LOOP;
 PERFORM pg_temp.expect_catalog_error('oversize name',format('SELECT public.bedos_mutate_service(%L,''create'',NULL,%L::jsonb)',actor,jsonb_build_object('name',repeat('n',201),'slug','s')::text),'22023');
 PERFORM pg_temp.expect_catalog_error('oversize description',format('SELECT public.bedos_mutate_service(%L,''update'',%L,%L::jsonb)',actor,s1,jsonb_build_object('description',repeat('x',10001))::text),'22023');
 PERFORM pg_temp.expect_catalog_error('blank text',format('SELECT public.bedos_mutate_service(%L,''update'',%L,''{"name":"  \t "}'')',actor,s1),'22023');
 PERFORM pg_temp.expect_catalog_error('empty update',format('SELECT public.bedos_mutate_service(%L,''update'',%L,''{}'')',actor,s1),'22023');
 PERFORM pg_temp.expect_catalog_error('category unsupported field',format('SELECT public.bedos_mutate_service_category(%L,''update'',%L,''{"featured":false}'')',actor,cat),'22023');
 PERFORM pg_temp.expect_catalog_error('invalid category FK',format('SELECT public.bedos_mutate_service(%L,''update'',%L,%L::jsonb)',actor,s1,jsonb_build_object('category_id',missing)::text),'22023');
 PERFORM pg_temp.expect_catalog_error('missing service update',format('SELECT public.bedos_mutate_service(%L,''update'',%L,''{"name":"n"}'')',actor,missing),'P0002');
 PERFORM pg_temp.expect_catalog_error('missing service deletion',format('SELECT public.bedos_mutate_service(%L,''delete'',%L,''{}'')',actor,missing),'P0002');
 PERFORM pg_temp.expect_catalog_error('missing category detail',format('SELECT public.bedos_read_service_catalog(p_actor_id=>%L,p_entity=>''categories'',p_id=>%L)',actor,missing),'P0002');
 PERFORM pg_temp.expect_catalog_error('duplicate service slug',format('SELECT public.bedos_mutate_service(%L,''create'',NULL,%L::jsonb)',actor,jsonb_build_object('name','n','slug',prefix||'-draft')::text),'23505');
 PERFORM pg_temp.expect_catalog_error('duplicate category name',format('SELECT public.bedos_mutate_service_category(%L,''create'',NULL,%L::jsonb)',actor,jsonb_build_object('name',prefix||' visible','slug',prefix||'-other')::text),'23505');
 PERFORM pg_temp.expect_catalog_error('duplicate category slug',format('SELECT public.bedos_mutate_service_category(%L,''create'',NULL,%L::jsonb)',actor,jsonb_build_object('name',prefix||' other','slug',prefix||'-visible')::text),'23505');
 PERFORM pg_temp.expect_catalog_error('public cannot select status','SELECT public.bedos_read_service_catalog(p_public=>true,p_status=>''draft'')','22023');
 PERFORM pg_temp.expect_catalog_error('public cannot select UUID',format('SELECT public.bedos_read_service_catalog(p_public=>true,p_id=>%L)',s1),'22023');
 PERFORM pg_temp.expect_catalog_error('public cannot carry actor',format('SELECT public.bedos_read_service_catalog(p_public=>true,p_actor_id=>%L)',actor),'22023');
 PERFORM pg_temp.expect_catalog_error('excessive list size','SELECT public.bedos_read_service_catalog(p_public=>true,p_page_size=>101)','22023');
 PERFORM pg_temp.expect_catalog_error('invalid page','SELECT public.bedos_read_service_catalog(p_public=>true,p_page=>0)','22023');
 PERFORM pg_temp.expect_catalog_error('invalid entity','SELECT public.bedos_read_service_catalog(p_public=>true,p_entity=>''audit_logs'')','22023');
 PERFORM pg_temp.expect_catalog_error('category cannot select service fields','SELECT public.bedos_read_service_catalog(p_public=>true,p_entity=>''categories'',p_featured=>true)','22023');

 SELECT to_jsonb(s) INTO before_value FROM public.services s WHERE id=s1;
 v:=public.bedos_mutate_service(actor,'update',s1,'{"name":"  New name  ","description":" ","featured":false,"category_id":null,"status":"published"}');
 PERFORM pg_temp.check_catalog('service update normalizes nullable values',v->>'name'='New name' AND v->'description'='null'::jsonb AND v->'category_id'='null'::jsonb AND v->>'status'='published');
 PERFORM pg_temp.check_catalog('service update preserves original creator and timestamp',v->>'created_by'=before_value->>'created_by' AND v->>'created_at'=before_value->>'created_at');
 PERFORM pg_temp.check_catalog('update audit actor before after result',EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=s1 AND action='service_updated' AND actor_id=actor AND metadata->'before'=before_value AND metadata->'after'=v AND metadata->>'result'='success'));
 v:=public.bedos_mutate_service(actor,'update',s1,jsonb_build_object('category_id',cat,'status','draft'));
 v:=public.bedos_mutate_service_category(staff,'update',cat,'{"description":"  Changed  "}');PERFORM pg_temp.check_catalog('content manager category update',v->>'description'='Changed');
 -- Limits apply only to provided new fields, preserving legacy records on unrelated edits.
 INSERT INTO public.services(name,slug,description,status) VALUES(repeat('l',201),prefix||repeat('x',201),repeat('d',10001),'published') RETURNING id INTO legacy;
 v:=public.bedos_mutate_service(actor,'update',legacy,'{"featured":true}');PERFORM pg_temp.check_catalog('legacy fields preserved',char_length(v->>'name')=201 AND char_length(v->>'description')=10001);
 v:=public.bedos_read_service_catalog(p_public=>true,p_slug=>prefix||repeat('x',201));PERFORM pg_temp.check_catalog('legacy slug remains readable',v->>'id'=legacy::text);

 FOREACH statement IN ARRAY ARRAY['service_created','service_updated','service_category_created','service_category_updated'] LOOP
  PERFORM set_config('bedos.catalog_fail_action',statement,true);
  SELECT count(*) INTO count_before FROM public.audit_logs;
  IF statement='service_created' THEN
   PERFORM pg_temp.expect_catalog_error('audit failure '||statement,format('SELECT public.bedos_mutate_service(%L,''create'',NULL,%L::jsonb)',actor,jsonb_build_object('name','Audit failure','slug',prefix||'-audit-failure')::text),'23514');
   PERFORM pg_temp.check_catalog('create rolled back',NOT EXISTS(SELECT 1 FROM public.services WHERE slug=prefix||'-audit-failure'));
  ELSIF statement='service_updated' THEN
   SELECT to_jsonb(s) INTO before_value FROM public.services s WHERE id=s1;
   PERFORM pg_temp.expect_catalog_error('audit failure '||statement,format('SELECT public.bedos_mutate_service(%L,''update'',%L,''{"name":"Audit failed"}'')',actor,s1),'23514');
   PERFORM pg_temp.check_catalog('update rolled back',(SELECT to_jsonb(s)=before_value FROM public.services s WHERE id=s1));
  ELSIF statement='service_category_created' THEN
   PERFORM pg_temp.expect_catalog_error('audit failure '||statement,format('SELECT public.bedos_mutate_service_category(%L,''create'',NULL,%L::jsonb)',actor,jsonb_build_object('name','Audit failure','slug',prefix||'-audit-failure')::text),'23514');
   PERFORM pg_temp.check_catalog('category create rolled back',NOT EXISTS(SELECT 1 FROM public.service_categories WHERE slug=prefix||'-audit-failure'));
  ELSE
   SELECT to_jsonb(c) INTO before_value FROM public.service_categories c WHERE id=cat;
   PERFORM pg_temp.expect_catalog_error('audit failure '||statement,format('SELECT public.bedos_mutate_service_category(%L,''update'',%L,''{"name":"Audit failed"}'')',actor,cat),'23514');
   PERFORM pg_temp.check_catalog('category update rolled back',(SELECT to_jsonb(c)=before_value FROM public.service_categories c WHERE id=cat));
  END IF;
  PERFORM pg_temp.check_catalog('no orphan audit '||statement,(SELECT count(*)=count_before FROM public.audit_logs));
 END LOOP;
 FOREACH statement IN ARRAY ARRAY['service_category_detached','service_category_deleted'] LOOP
  PERFORM set_config('bedos.catalog_fail_action',statement,true);SELECT count(*) INTO count_before FROM public.audit_logs;
  PERFORM pg_temp.expect_catalog_error('audit failure '||statement,format('SELECT public.bedos_mutate_service_category(%L,''delete'',%L,''{}'')',actor,cat),'23514');
  PERFORM pg_temp.check_catalog('category detach rollback '||statement,EXISTS(SELECT 1 FROM public.service_categories WHERE id=cat) AND (SELECT count(*)=2 FROM public.services WHERE category_id=cat) AND (SELECT count(*)=count_before FROM public.audit_logs));
 END LOOP;
 PERFORM set_config('bedos.catalog_fail_action','',true);
 v:=public.bedos_mutate_service_category(actor,'delete',cat,'{}');
 PERFORM pg_temp.check_catalog('category deletion retains services and nulls category',NOT EXISTS(SELECT 1 FROM public.service_categories WHERE id=cat) AND (SELECT count(*)=2 FROM public.services WHERE id IN(s1,s2) AND category_id IS NULL));
 PERFORM pg_temp.check_catalog('each category detachment audited',(SELECT count(*)=2 FROM public.audit_logs WHERE action='service_category_detached' AND metadata->'before'->>'category_id'=cat::text AND metadata->'after'->'category_id'='null'::jsonb AND actor_id=actor));
 INSERT INTO public.enquiries(enquiry_type,service_id) VALUES('quote_request',s2) RETURNING id INTO enquiry;
 INSERT INTO public.enquiries(enquiry_type,service_id) VALUES('maintenance_request',s2) RETURNING id INTO enquiry2;
 FOREACH statement IN ARRAY ARRAY['enquiry_service_detached','service_deleted'] LOOP
  PERFORM set_config('bedos.catalog_fail_action',statement,true);SELECT count(*) INTO count_before FROM public.audit_logs;
  PERFORM pg_temp.expect_catalog_error('audit failure '||statement,format('SELECT public.bedos_mutate_service(%L,''delete'',%L,''{}'')',actor,s2),'23514');
  PERFORM pg_temp.check_catalog('service detach rollback '||statement,EXISTS(SELECT 1 FROM public.services WHERE id=s2) AND (SELECT count(*)=2 FROM public.enquiries WHERE service_id=s2) AND (SELECT count(*)=count_before FROM public.audit_logs));
 END LOOP;
 PERFORM set_config('bedos.catalog_fail_action','',true);
 v:=public.bedos_mutate_service(actor,'delete',s2,'{}');
 PERFORM pg_temp.check_catalog('service deletion retains enquiries and nulls service',NOT EXISTS(SELECT 1 FROM public.services WHERE id=s2) AND (SELECT count(*)=2 FROM public.enquiries WHERE id IN(enquiry,enquiry2) AND service_id IS NULL));
 PERFORM pg_temp.check_catalog('each enquiry detachment audited',(SELECT count(*)=2 FROM public.audit_logs WHERE action='enquiry_service_detached' AND metadata->'before'->>'service_id'=s2::text AND metadata->'after'->'service_id'='null'::jsonb AND actor_id=actor));
 PERFORM pg_temp.check_catalog('service deletion has original image and actor',EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=s2 AND action='service_deleted' AND actor_id=actor AND metadata->'before'->>'slug'=prefix||'-published' AND metadata->'after'='null'::jsonb));
 -- Real invocation with service role succeeds, without permitting direct writes.
 SET LOCAL ROLE service_role;
 v:=public.bedos_mutate_service(actor,'update',s4,'{"featured":true}');
 RESET ROLE;
 PERFORM pg_temp.check_catalog('service role executes guarded RPC',v->'featured'='true'::jsonb);
 UPDATE public.profiles SET role_id=customer_role WHERE id=staff;
 PERFORM pg_temp.expect_catalog_error('role change reflected in DB read',format('SELECT public.bedos_read_service_catalog(%L)',staff),'42501');
 PERFORM pg_temp.expect_catalog_error('role change reflected in DB write',format('SELECT public.bedos_mutate_service(%L,''update'',%L,''{"featured":true}'')',staff,s4),'42501');
END;$test$;
