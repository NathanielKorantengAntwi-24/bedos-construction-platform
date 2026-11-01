CREATE TEMP TABLE status_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.check_status(p_name text,p_pass boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF p_pass IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Assertion failed: %',p_name; END IF;
 INSERT INTO status_checks VALUES(p_name);
END; $$;
CREATE FUNCTION pg_temp.expect_status_error(p_name text,p_actor uuid,p_target uuid,p_new text,p_old text,p_reason text,p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  PERFORM public.bedos_update_user_status(p_actor,p_target,p_new,p_old,p_reason);
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> p_code THEN RAISE; END IF;
  INSERT INTO status_checks VALUES(p_name);
  RETURN;
 END;
 RAISE EXCEPTION 'Expected failure missing: %',p_name;
END; $$;
CREATE FUNCTION pg_temp.fail_status_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action='user_account_status_changed' AND NEW.entity_id::text=current_setting('bedos.status_test_target',true) THEN
  RAISE EXCEPTION 'Synthetic local audit failure' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER bedos_status_test_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_status_audit();
DO $test$
DECLARE
 actor uuid:=gen_random_uuid(); other_admin uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid();
 unconfirmed uuid:=gen_random_uuid(); pending uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid();
 staff uuid; role_row record; admin_role uuid; customer_role uuid; manager_role uuid;
 service_id uuid:=gen_random_uuid(); result jsonb; invite uuid; actual_role text; visible integer;
 token text:=gen_random_uuid()::text; audit_count integer;
BEGIN
 SELECT id INTO admin_role FROM public.roles WHERE name='administrator';
 SELECT id INTO customer_role FROM public.roles WHERE name='customer';
 SELECT id INTO manager_role FROM public.roles WHERE name='content_manager';
 INSERT INTO auth.users(id,email,raw_user_meta_data,email_confirmed_at) VALUES
 (actor,actor::text||'@bedos-status-test.invalid','{"full_name":"Status test admin"}',now()),
 (other_admin,other_admin::text||'@bedos-status-test.invalid','{"full_name":"Status test protected admin"}',now()),
 (customer,customer::text||'@bedos-status-test.invalid','{"full_name":"Status test customer"}',now()),
 (unconfirmed,unconfirmed::text||'@bedos-status-test.invalid','{"full_name":"Status test unconfirmed"}',NULL),
 (pending,pending::text||'@bedos-status-test.invalid','{"full_name":"Status test pending"}',NULL),
 (legacy,legacy::text||'@bedos-status-test.invalid','{"full_name":"Status test legacy"}',now());
 UPDATE public.profiles SET role_id=admin_role,account_status='active' WHERE id IN(actor,other_admin);
 UPDATE public.profiles SET role_id=customer_role,account_status='active' WHERE id=customer;
 UPDATE public.profiles SET role_id=customer_role,account_status='suspended' WHERE id=unconfirmed;
 UPDATE public.profiles SET role_id=manager_role,account_status='inactive' WHERE id=pending;
 UPDATE public.profiles SET role_id=manager_role,account_status='active' WHERE id=legacy;
 INSERT INTO public.services(id,name,slug,status) VALUES(service_id,'Status access fixture',token,'published');
 PERFORM pg_temp.check_status('function security',EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.bedos_update_user_status(uuid,uuid,text,text,text)'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=""']));
 PERFORM pg_temp.check_status('service execute',has_function_privilege('service_role','public.bedos_update_user_status(uuid,uuid,text,text,text)','EXECUTE'));
 PERFORM pg_temp.check_status('anon denied',NOT has_function_privilege('anon','public.bedos_update_user_status(uuid,uuid,text,text,text)','EXECUTE'));
 PERFORM pg_temp.check_status('authenticated denied',NOT has_function_privilege('authenticated','public.bedos_update_user_status(uuid,uuid,text,text,text)','EXECUTE'));
 PERFORM set_config('request.jwt.claim.sub',customer::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',customer,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT public.get_user_role() INTO actual_role;
 SELECT count(*) INTO visible FROM public.services WHERE id=service_id;
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_status('existing claims active access',actual_role='customer' AND visible=1);
 result:=public.bedos_update_user_status(actor,customer,'suspended','active','  Review requested  ');
 PERFORM pg_temp.check_status('customer suspended',result=jsonb_build_object('user_id',customer,'account_status','suspended'));
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT public.get_user_role() INTO actual_role;
 SELECT count(*) INTO visible FROM public.services WHERE id=service_id;
 BEGIN
  PERFORM public.update_own_profile('Forbidden suspended change',NULL);
  RAISE EXCEPTION 'Suspended legacy profile update accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_status('same existing claims blocked',actual_role IS NULL AND visible=0);
 PERFORM pg_temp.check_status('same existing claims profile RPC denied',(SELECT full_name='Status test customer' FROM public.profiles WHERE id=customer));
 PERFORM pg_temp.check_status('suspension audit atomic',EXISTS(SELECT 1 FROM public.audit_logs WHERE actor_id=actor AND entity_id=customer AND action='user_account_status_changed' AND metadata->>'previous_account_status'='active' AND metadata->>'account_status'='suspended' AND metadata->>'reason'='Review requested'));
 PERFORM pg_temp.expect_status_error('stale expected state',actor,customer,'suspended','active','stale','P0001');
 PERFORM pg_temp.expect_status_error('no-op state',actor,customer,'suspended','suspended','noop','P0001');
 result:=public.bedos_update_user_status(actor,customer,'active','suspended','Approved restoration');
 PERFORM pg_temp.check_status('confirmed customer restored',result->>'account_status'='active');
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT public.get_user_role() INTO actual_role;
 SELECT count(*) INTO visible FROM public.services WHERE id=service_id;
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_status('same existing claims restored',actual_role='customer' AND visible=1);
 SELECT count(*) INTO audit_count FROM public.audit_logs WHERE entity_id=customer AND action='user_account_status_changed';
 PERFORM pg_temp.check_status('no duplicate failed audit events',audit_count=2);
 PERFORM pg_temp.expect_status_error('unconfirmed restoration denied',actor,unconfirmed,'active','suspended','review','P0001');
 PERFORM pg_temp.expect_status_error('self target denied',actor,actor,'suspended','active','review','42501');
 PERFORM pg_temp.expect_status_error('other administrator denied',actor,other_admin,'suspended','active','review','42501');
 PERFORM pg_temp.expect_status_error('missing target',actor,gen_random_uuid(),'suspended','active','review','P0002');
 PERFORM pg_temp.expect_status_error('ordinary actor denied',customer,legacy,'suspended','active','review','42501');
 PERFORM pg_temp.expect_status_error('missing actor denied',gen_random_uuid(),customer,'suspended','active','review','42501');
 UPDATE public.profiles SET account_status='suspended' WHERE id=actor;
 PERFORM pg_temp.expect_status_error('suspended actor denied',actor,customer,'suspended','active','review','42501');
 UPDATE public.profiles SET account_status='inactive' WHERE id=actor;
 PERFORM pg_temp.expect_status_error('inactive actor denied',actor,customer,'suspended','active','review','42501');
 UPDATE public.profiles SET account_status='active' WHERE id=actor;
 PERFORM pg_temp.expect_status_error('invalid target status',actor,customer,'inactive','active','review','22023');
 PERFORM pg_temp.expect_status_error('invalid expected status',actor,customer,'suspended','pending','review','22023');
 PERFORM pg_temp.expect_status_error('blank reason',actor,customer,'suspended','active',E'\t\n ','22023');
 PERFORM pg_temp.expect_status_error('null reason',actor,customer,'suspended','active',NULL,'22023');
 PERFORM pg_temp.expect_status_error('long reason',actor,customer,'suspended','active',repeat('x',501),'22023');
 PERFORM pg_temp.expect_status_error('legacy staff denied',actor,legacy,'suspended','active','review','P0001');
 invite:=public.bedos_authorize_staff_invitation(pending,actor,manager_role);
 PERFORM pg_temp.expect_status_error('inactive onboarding cannot restore',actor,pending,'active','inactive','review','P0001');
 UPDATE public.profiles SET account_status='active' WHERE id=pending;
 PERFORM pg_temp.expect_status_error('pending proof cannot suspend',actor,pending,'suspended','active','review','P0001');
 UPDATE public.profiles SET account_status='inactive' WHERE id=pending;
 PERFORM public.bedos_revoke_staff_invitation(pending,actor);
 UPDATE public.profiles SET account_status='suspended' WHERE id=pending;
 PERFORM pg_temp.expect_status_error('revoked proof cannot restore',actor,pending,'active','suspended','review','P0001');
 UPDATE public.profiles SET role_id=customer_role WHERE id=pending;
 PERFORM pg_temp.expect_status_error('customer cannot bypass incompatible invitation',actor,pending,'active','suspended','review','P0001');
 FOR role_row IN SELECT id,name FROM public.roles WHERE name IN('content_manager','finance','sales_customer_service') LOOP
  staff:=gen_random_uuid();
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(staff,staff::text||'@bedos-status-test.invalid','{"full_name":"Status test staff"}');
  UPDATE public.profiles SET role_id=role_row.id,account_status='inactive' WHERE id=staff;
  invite:=public.bedos_authorize_staff_invitation(staff,actor,role_row.id);
  PERFORM public.bedos_record_staff_invitation_password_baseline(staff);
  UPDATE auth.users SET email_confirmed_at=now(),encrypted_password='synthetic-local-changed' WHERE id=staff;
  PERFORM public.bedos_activate_staff_invitation(staff,actor);
  result:=public.bedos_update_user_status(actor,staff,'suspended','active','review');
  PERFORM pg_temp.check_status(role_row.name||' suspension',result->>'account_status'='suspended');
  result:=public.bedos_update_user_status(actor,staff,'active','suspended','restore');
  PERFORM pg_temp.check_status(role_row.name||' restoration',result->>'account_status'='active');
  IF role_row.name='content_manager' THEN
   UPDATE public.profiles SET role_id=customer_role WHERE id=staff;
   PERFORM pg_temp.expect_status_error('mismatched approved role denied',actor,staff,'suspended','active','review','P0001');
   UPDATE public.profiles SET role_id=role_row.id WHERE id=staff;
  END IF;
 END LOOP;
 PERFORM set_config('bedos.status_test_target',customer::text,true);
 PERFORM pg_temp.expect_status_error('audit failure surfaced',actor,customer,'suspended','active','audit rollback','23514');
 PERFORM pg_temp.check_status('audit failure rolls back profile',(SELECT account_status='active' FROM public.profiles WHERE id=customer));
 PERFORM pg_temp.check_status('audit failure leaves audit unchanged',(SELECT count(*) FROM public.audit_logs WHERE entity_id=customer AND action='user_account_status_changed')=audit_count);
 PERFORM set_config('bedos.status_test_target','',true);
 EXECUTE 'SET LOCAL ROLE anon';
 BEGIN PERFORM public.bedos_update_user_status(actor,customer,'suspended','active','forged'); RAISE EXCEPTION 'Anon accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_status('anon forged actor invocation denied',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.bedos_update_user_status(actor,customer,'suspended','active','forged'); RAISE EXCEPTION 'Authenticated accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_status('authenticated forged actor invocation denied',true);
 EXECUTE 'SET LOCAL ROLE service_role';
 result:=public.bedos_update_user_status(actor,customer,'suspended','active','Service call');
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_status('service actual execution',result->>'account_status'='suspended');
END; $test$;
SELECT json_build_object('assertions',count(*)) FROM status_checks;
