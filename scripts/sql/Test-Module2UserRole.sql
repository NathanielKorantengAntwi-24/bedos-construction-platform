CREATE TEMP TABLE role_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.check_role(p_name text,p_pass boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF p_pass IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Assertion failed: %',p_name; END IF;
 INSERT INTO role_checks VALUES(p_name);
END; $$;
CREATE FUNCTION pg_temp.expect_role_error(p_name text,p_actor uuid,p_target uuid,p_role uuid,p_expected uuid,p_reason text,p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN PERFORM public.bedos_update_user_role(p_actor,p_target,p_role,p_expected,p_reason);
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>p_code THEN RAISE; END IF;
  INSERT INTO role_checks VALUES(p_name);RETURN;
 END;
 RAISE EXCEPTION 'Expected role failure missing: %',p_name;
END; $$;
CREATE FUNCTION pg_temp.fail_role_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action='staff_role_changed' AND NEW.entity_id::text=current_setting('bedos.role_test_target',true) THEN
  RAISE EXCEPTION 'Synthetic role audit failure' USING ERRCODE='23514';
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER bedos_role_test_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_role_audit();
DO $test$
DECLARE
 actor uuid:=gen_random_uuid(); other_admin uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid();
 staff uuid:=gen_random_uuid(); pending uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid();
 admin_role uuid; customer_role uuid; manager uuid; finance uuid; sales uuid; invitation uuid;
 before_invite jsonb; after_invite jsonb; result jsonb; actual_role text; visible integer;
 service_id uuid:=gen_random_uuid(); audit_count integer; dest record;
BEGIN
 SELECT id INTO admin_role FROM public.roles WHERE name='administrator';
 SELECT id INTO customer_role FROM public.roles WHERE name='customer';
 SELECT id INTO manager FROM public.roles WHERE name='content_manager';
 SELECT id INTO finance FROM public.roles WHERE name='finance';
 SELECT id INTO sales FROM public.roles WHERE name='sales_customer_service';
 INSERT INTO auth.users(id,email,raw_user_meta_data,email_confirmed_at) VALUES
 (actor,actor::text||'@bedos-role-change-test.invalid','{"full_name":"Role change actor"}',now()),
 (other_admin,other_admin::text||'@bedos-role-change-test.invalid','{"full_name":"Role change protected admin"}',now()),
 (customer,customer::text||'@bedos-role-change-test.invalid','{"full_name":"Role change customer"}',now()),
 (staff,staff::text||'@bedos-role-change-test.invalid','{"full_name":"Role change staff"}',now()),
 (pending,pending::text||'@bedos-role-change-test.invalid','{"full_name":"Role change pending"}',now()),
 (legacy,legacy::text||'@bedos-role-change-test.invalid','{"full_name":"Role change legacy"}',now());
 UPDATE public.profiles SET role_id=admin_role,account_status='active' WHERE id IN(actor,other_admin);
 UPDATE public.profiles SET role_id=customer_role,account_status='active' WHERE id=customer;
 UPDATE public.profiles SET role_id=manager,account_status='inactive' WHERE id IN(staff,pending);
 UPDATE public.profiles SET role_id=manager,account_status='active' WHERE id=legacy;
 invitation:=public.bedos_authorize_staff_invitation(staff,actor,manager);
 PERFORM public.bedos_record_staff_invitation_password_baseline(staff);
 UPDATE auth.users SET encrypted_password='synthetic-local-password-change' WHERE id=staff;
 PERFORM public.bedos_activate_staff_invitation(staff,actor);
 SELECT to_jsonb(si)-'approved_role_id' INTO before_invite FROM public.staff_invitations si WHERE id=invitation;
 INSERT INTO public.services(id,name,slug,status) VALUES(service_id,'Role change access fixture',service_id::text,'draft');
 PERFORM pg_temp.check_role('secure function',EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.bedos_update_user_role(uuid,uuid,uuid,uuid,text)'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=""']));
 PERFORM pg_temp.check_role('service execute',has_function_privilege('service_role','public.bedos_update_user_role(uuid,uuid,uuid,uuid,text)','EXECUTE'));
 PERFORM pg_temp.check_role('anon denied',NOT has_function_privilege('anon','public.bedos_update_user_role(uuid,uuid,uuid,uuid,text)','EXECUTE'));
 PERFORM pg_temp.check_role('authenticated denied',NOT has_function_privilege('authenticated','public.bedos_update_user_role(uuid,uuid,uuid,uuid,text)','EXECUTE'));
 PERFORM set_config('request.jwt.claim.sub',staff::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT public.get_user_role() INTO actual_role; SELECT count(*) INTO visible FROM public.services WHERE id=service_id;
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_role('initial content claims access',actual_role='content_manager' AND visible=1);
 result:=public.bedos_update_user_role(actor,staff,finance,manager,'  Finance assignment  ');
 PERFORM pg_temp.check_role('finance change result',result=jsonb_build_object('user_id',staff,'role',jsonb_build_object('id',finance,'name','finance')));
 PERFORM pg_temp.check_role('profile role changed',(SELECT role_id=finance AND account_status='active' FROM public.profiles WHERE id=staff));
 PERFORM pg_temp.check_role('invitation role changed atomically',(SELECT approved_role_id=finance AND status='activated' FROM public.staff_invitations WHERE id=invitation));
 SELECT to_jsonb(si)-'approved_role_id' INTO after_invite FROM public.staff_invitations si WHERE id=invitation;
 PERFORM pg_temp.check_role('other invitation proof unchanged',after_invite=before_invite);
 PERFORM pg_temp.check_role('audit before after reason',EXISTS(SELECT 1 FROM public.audit_logs WHERE action='staff_role_changed' AND entity_id=staff AND actor_id=actor AND metadata->>'previous_role_id'=manager::text AND metadata->>'previous_role_name'='content_manager' AND metadata->>'role_id'=finance::text AND metadata->>'role_name'='finance' AND metadata->>'reason'='Finance assignment' AND metadata->>'invitation_id'=invitation::text));
 PERFORM pg_temp.check_role('original authorization audit preserved',EXISTS(SELECT 1 FROM public.audit_logs WHERE action='staff_invitation_authorized' AND entity_id=staff AND metadata->>'approved_role_id'=manager::text));
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT public.get_user_role() INTO actual_role; SELECT count(*) INTO visible FROM public.services WHERE id=service_id;
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_role('same claims lose content access',actual_role='finance' AND visible=0);
 PERFORM pg_temp.expect_role_error('stale expected role',actor,staff,sales,manager,'stale','P0001');
 PERFORM pg_temp.expect_role_error('no-op role',actor,staff,finance,finance,'noop','P0001');
 result:=public.bedos_update_user_status(actor,staff,'suspended','active','Status compatibility');
 PERFORM pg_temp.check_role('new proof supports suspension',result->>'account_status'='suspended');
 PERFORM pg_temp.expect_role_error('suspended staff cannot change role',actor,staff,sales,finance,'blocked','P0001');
 result:=public.bedos_update_user_status(actor,staff,'active','suspended','Status compatibility restore');
 PERFORM pg_temp.check_role('new proof supports restoration',result->>'account_status'='active');
 result:=public.bedos_update_user_role(actor,staff,sales,finance,'Sales assignment');
 PERFORM pg_temp.check_role('sales assignment',result->'role'->>'name'='sales_customer_service');
 result:=public.bedos_update_user_role(actor,staff,manager,sales,'Content reassignment');
 PERFORM pg_temp.check_role('content reassignment',result->'role'->>'name'='content_manager');
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT public.get_user_role() INTO actual_role; SELECT count(*) INTO visible FROM public.services WHERE id=service_id;
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_role('same claims regain content access',actual_role='content_manager' AND visible=1);
 FOR dest IN SELECT id,name FROM public.roles WHERE name IN('administrator','customer') LOOP
  PERFORM pg_temp.expect_role_error('protected destination '||dest.name,actor,staff,dest.id,manager,'blocked','42501');
 END LOOP;
 PERFORM pg_temp.expect_role_error('protected admin target',actor,other_admin,finance,admin_role,'blocked','42501');
 PERFORM pg_temp.expect_role_error('protected customer target',actor,customer,finance,customer_role,'blocked','42501');
 PERFORM pg_temp.expect_role_error('self role change',actor,actor,finance,admin_role,'blocked','42501');
 PERFORM pg_temp.expect_role_error('ordinary actor',staff,legacy,finance,manager,'blocked','42501');
 PERFORM pg_temp.expect_role_error('missing actor',gen_random_uuid(),staff,finance,manager,'blocked','42501');
 UPDATE public.profiles SET account_status='suspended' WHERE id=actor;
 PERFORM pg_temp.expect_role_error('suspended actor',actor,staff,finance,manager,'blocked','42501');
 UPDATE public.profiles SET account_status='inactive' WHERE id=actor;
 PERFORM pg_temp.expect_role_error('inactive actor',actor,staff,finance,manager,'blocked','42501');
 UPDATE public.profiles SET account_status='active' WHERE id=actor;
 PERFORM pg_temp.expect_role_error('missing target',actor,gen_random_uuid(),finance,manager,'blocked','P0002');
 PERFORM pg_temp.expect_role_error('unknown role',actor,staff,gen_random_uuid(),manager,'blocked','22023');
 PERFORM pg_temp.expect_role_error('missing reason',actor,staff,finance,manager,NULL,'22023');
 PERFORM pg_temp.expect_role_error('blank reason',actor,staff,finance,manager,E'\t\n ','22023');
 PERFORM pg_temp.expect_role_error('long reason',actor,staff,finance,manager,repeat('x',501),'22023');
 PERFORM pg_temp.expect_role_error('legacy staff no proof',actor,legacy,finance,manager,'blocked','P0001');
 PERFORM public.bedos_authorize_staff_invitation(pending,actor,manager);
 PERFORM pg_temp.expect_role_error('inactive pending target',actor,pending,finance,manager,'blocked','P0001');
 UPDATE public.profiles SET account_status='active' WHERE id=pending;
 PERFORM pg_temp.expect_role_error('pending proof rejected',actor,pending,finance,manager,'blocked','P0001');
 UPDATE public.profiles SET account_status='inactive' WHERE id=pending;
 PERFORM public.bedos_revoke_staff_invitation(pending,actor);
 UPDATE public.profiles SET account_status='active' WHERE id=pending;
 PERFORM pg_temp.expect_role_error('revoked proof rejected',actor,pending,finance,manager,'blocked','P0001');
 UPDATE public.staff_invitations SET approved_role_id=finance WHERE id=invitation;
 PERFORM pg_temp.expect_role_error('mismatched invitation role',actor,staff,finance,manager,'blocked','P0001');
 UPDATE public.staff_invitations SET approved_role_id=manager WHERE id=invitation;
 SELECT count(*) INTO audit_count FROM public.audit_logs WHERE action='staff_role_changed' AND entity_id=staff;
 PERFORM pg_temp.check_role('three successful role audits only',audit_count=3);
 PERFORM set_config('bedos.role_test_target',staff::text,true);
 PERFORM pg_temp.expect_role_error('audit failure surfaced',actor,staff,finance,manager,'rollback','23514');
 PERFORM pg_temp.check_role('audit failure rolls back profile',(SELECT role_id=manager FROM public.profiles WHERE id=staff));
 PERFORM pg_temp.check_role('audit failure rolls back invitation',(SELECT approved_role_id=manager FROM public.staff_invitations WHERE id=invitation));
 PERFORM pg_temp.check_role('audit failure no partial audit',(SELECT count(*) FROM public.audit_logs WHERE action='staff_role_changed' AND entity_id=staff)=audit_count);
 PERFORM set_config('bedos.role_test_target','',true);
 EXECUTE 'SET LOCAL ROLE anon';
 BEGIN PERFORM public.bedos_update_user_role(actor,staff,finance,manager,'forged');RAISE EXCEPTION 'Anon accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';PERFORM pg_temp.check_role('anon forged actor denied',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.bedos_update_user_role(actor,staff,finance,manager,'forged');RAISE EXCEPTION 'Authenticated accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';PERFORM pg_temp.check_role('authenticated forged actor denied',true);
 EXECUTE 'SET LOCAL ROLE service_role';
 result:=public.bedos_update_user_role(actor,staff,finance,manager,'Service execution');
 EXECUTE 'RESET ROLE';PERFORM pg_temp.check_role('actual service execution',result->'role'->>'name'='finance');
END; $test$;
SELECT json_build_object('assertions',count(*)) FROM role_checks;
