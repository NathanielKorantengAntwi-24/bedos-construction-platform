CREATE TEMP TABLE setup_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.check_setup(p_name text,p_pass boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_pass IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Setup assertion failed: %',p_name;END IF;INSERT INTO setup_checks VALUES(p_name);END;$$;
CREATE FUNCTION pg_temp.expect_setup_error(p_name text,p_target uuid,p_actor uuid,p_reason text,p_resume boolean,p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN PERFORM public.bedos_setup_staff_invitation(p_target,p_actor,p_reason,p_resume);
 EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>p_code THEN RAISE;END IF;INSERT INTO setup_checks VALUES(p_name);RETURN;END;
 RAISE EXCEPTION 'Expected setup failure missing: %',p_name;
END;$$;
CREATE FUNCTION pg_temp.setup_fixture(p_actor uuid,p_role uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid:=gen_random_uuid();v_email text;
BEGIN
 v_email:=v_id::text||'@bedos-setup-test.invalid';
 INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES(v_id,v_email,
 jsonb_build_object('full_name','Unconfigured','bedos_staff_onboarding_pending',true),
 jsonb_build_object('bedos_staff_invitation',jsonb_build_object('version',1,'request_id',gen_random_uuid(),
 'requested_role_id',p_role,'created_by',p_actor,'email',v_email,'full_name','Trusted Original Name','phone','123')));
 RETURN v_id;
END;$$;
CREATE FUNCTION pg_temp.fail_setup_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.entity_id::text=current_setting('bedos.setup_test_target',true) AND NEW.action=current_setting('bedos.setup_test_action',true) THEN
 RAISE EXCEPTION 'Synthetic setup audit failure' USING ERRCODE='23514';END IF;RETURN NEW;
END;$$;
CREATE FUNCTION pg_temp.fail_setup_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id::text=current_setting('bedos.setup_profile_target',true) THEN RAISE EXCEPTION 'Synthetic setup profile failure' USING ERRCODE='23514';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER bedos_setup_test_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_setup_audit();
CREATE TRIGGER bedos_setup_test_profile BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_setup_profile();
DO $test$
DECLARE actor uuid:=gen_random_uuid();second_actor uuid:=gen_random_uuid();admin_role uuid;customer_role uuid;finance uuid;manager uuid;
 target uuid;forged uuid;fresh uuid;profile_fail uuid;legacy uuid;other uuid;invite uuid;again uuid;marker jsonb;entry record;baseline text;
BEGIN
 SELECT id INTO admin_role FROM public.roles WHERE name='administrator';SELECT id INTO customer_role FROM public.roles WHERE name='customer';
 SELECT id INTO finance FROM public.roles WHERE name='finance';SELECT id INTO manager FROM public.roles WHERE name='content_manager';
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(actor,actor::text||'@bedos-setup-test.invalid','{"full_name":"Setup actor"}'),(second_actor,second_actor::text||'@bedos-setup-test.invalid','{"full_name":"Setup second actor"}');
 UPDATE public.profiles SET role_id=admin_role,account_status='active' WHERE id IN(actor,second_actor);
 target:=pg_temp.setup_fixture(actor,finance);
 PERFORM pg_temp.check_setup('definer empty path',EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.bedos_setup_staff_invitation(uuid,uuid,text,boolean)'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=""']));
 PERFORM pg_temp.check_setup('service execute',has_function_privilege('service_role','public.bedos_setup_staff_invitation(uuid,uuid,text,boolean)','EXECUTE'));
 PERFORM pg_temp.check_setup('anon execute denied',NOT has_function_privilege('anon','public.bedos_setup_staff_invitation(uuid,uuid,text,boolean)','EXECUTE'));
 PERFORM pg_temp.check_setup('authenticated execute denied',NOT has_function_privilege('authenticated','public.bedos_setup_staff_invitation(uuid,uuid,text,boolean)','EXECUTE'));
 invite:=public.bedos_setup_staff_invitation(target,actor,'Initial setup',false);
 PERFORM pg_temp.check_setup('profile configured and inactive',EXISTS(SELECT 1 FROM public.profiles WHERE id=target AND role_id=finance AND account_status='inactive' AND full_name='Trusted Original Name' AND phone='123'));
 PERFORM pg_temp.check_setup('approval created atomically',EXISTS(SELECT 1 FROM public.staff_invitations WHERE id=invite AND user_id=target AND invited_by=actor AND approved_role_id=finance AND status='pending'));
 PERFORM pg_temp.check_setup('initial audit exists',EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=target AND action='staff_invitation_authorized' AND actor_id=actor));
 again:=public.bedos_setup_staff_invitation(target,second_actor,'  Resume recheck  ',true);
 PERFORM pg_temp.check_setup('idempotent approval identity',again=invite);
 PERFORM pg_temp.check_setup('no duplicate approval',(SELECT count(*) FROM public.audit_logs WHERE entity_id=target AND action='staff_invitation_authorized')=1);
 PERFORM pg_temp.check_setup('resume records actor creator reason',EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=target AND action='staff_invitation_setup_resumed' AND actor_id=second_actor AND metadata->>'original_creator'=actor::text AND metadata->>'reason'='Resume recheck'));
 PERFORM public.bedos_record_staff_invitation_password_baseline(target);
 SELECT password_baseline_digest INTO baseline FROM public.staff_invitations WHERE id=invite;
 PERFORM public.bedos_setup_staff_invitation(target,actor,'Keep proof',true);
 PERFORM pg_temp.check_setup('setup never overwrites baseline',(SELECT password_baseline_digest=baseline FROM public.staff_invitations WHERE id=invite));
 PERFORM pg_temp.check_setup('server proof remains unchanged',EXISTS(SELECT 1 FROM auth.users WHERE id=target AND raw_app_meta_data->'bedos_staff_invitation'->>'requested_role_id'=finance::text AND raw_app_meta_data->'bedos_staff_invitation'->>'created_by'=actor::text));
 UPDATE public.profiles SET role_id=customer_role WHERE id=target;
 PERFORM public.bedos_setup_staff_invitation(target,actor,'Repair default profile',true);
 PERFORM pg_temp.check_setup('bound role repair on trusted pending',(SELECT role_id=finance FROM public.profiles WHERE id=target));
 forged:=gen_random_uuid();INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(forged,forged::text||'@bedos-setup-test.invalid',jsonb_build_object('full_name','Forged','bedos_staff_onboarding_pending',true,'bedos_staff_invitation',jsonb_build_object('version',1,'requested_role_id',finance,'created_by',actor)));
 PERFORM pg_temp.expect_setup_error('mutable flag is not provenance',forged,actor,'Reject forged',true,'42501');
 PERFORM pg_temp.check_setup('unrelated customer role unchanged',(SELECT role_id=customer_role FROM public.profiles WHERE id=forged));
 other:=pg_temp.setup_fixture(actor,finance);SELECT raw_app_meta_data->'bedos_staff_invitation' INTO marker FROM auth.users WHERE id=other;
 FOR entry IN SELECT * FROM (VALUES
 ('version','2'::jsonb),('request_id','"not-a-uuid"'::jsonb),('requested_role_id','"bad"'::jsonb),('created_by','null'::jsonb),
 ('email','"different@example.invalid"'::jsonb),('full_name','""'::jsonb),('phone','{}'::jsonb)) AS x(key,value) LOOP
  UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('bedos_staff_invitation',jsonb_set(marker,ARRAY[entry.key],entry.value)) WHERE id=other;
  PERFORM pg_temp.expect_setup_error('bad marker '||entry.key,other,actor,'Reject bad proof',true,'42501');
 END LOOP;
 UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('bedos_staff_invitation',marker) WHERE id=other;
 UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('bedos_staff_invitation',jsonb_set(marker,'{requested_role_id}',to_jsonb(admin_role::text))) WHERE id=other;
 PERFORM pg_temp.expect_setup_error('administrator destination blocked',other,actor,'Reject protected',true,'42501');
 UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('bedos_staff_invitation',jsonb_set(marker,'{requested_role_id}',to_jsonb(customer_role::text))) WHERE id=other;
 PERFORM pg_temp.expect_setup_error('customer destination blocked',other,actor,'Reject customer',true,'42501');
 UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('bedos_staff_invitation',jsonb_set(marker,'{requested_role_id}',to_jsonb(gen_random_uuid()::text))) WHERE id=other;
 PERFORM pg_temp.expect_setup_error('unknown destination blocked',other,actor,'Reject missing role',true,'42501');
 UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('bedos_staff_invitation',marker) WHERE id=other;
 UPDATE public.profiles SET account_status='active' WHERE id=other;
 PERFORM pg_temp.expect_setup_error('active account not reassigned',other,actor,'Reject active',true,'P0001');
 UPDATE public.profiles SET account_status='suspended' WHERE id=other;
 PERFORM pg_temp.expect_setup_error('suspended account not reassigned',other,actor,'Reject suspended',true,'P0001');
 UPDATE public.profiles SET account_status='inactive',role_id=manager WHERE id=other;
 PERFORM pg_temp.expect_setup_error('other staff role not overwritten',other,actor,'Reject changed role',true,'P0001');
 UPDATE public.profiles SET role_id=admin_role WHERE id=other;
 PERFORM pg_temp.expect_setup_error('administrator target blocked',other,actor,'Reject protected',true,'42501');
 UPDATE public.profiles SET role_id=customer_role WHERE id=other;
 UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data||'{"bedos_staff_onboarding_pending":false}'::jsonb WHERE id=other;
 PERFORM pg_temp.expect_setup_error('changed pending state closed',other,actor,'Reject state',true,'P0001');
 UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data||'{"bedos_staff_onboarding_pending":true}'::jsonb WHERE id=other;
 DELETE FROM public.profiles WHERE id=other;
 PERFORM pg_temp.expect_setup_error('missing profile controlled review',other,actor,'Review profile',true,'P0001');
 PERFORM pg_temp.expect_setup_error('missing Auth identity',gen_random_uuid(),actor,'Missing user',true,'P0002');
 PERFORM pg_temp.expect_setup_error('self setup denied',actor,actor,'Self',true,'42501');
 PERFORM pg_temp.expect_setup_error('ordinary actor denied',target,forged,'Ordinary',true,'42501');
 UPDATE public.profiles SET account_status='suspended' WHERE id=actor;
 PERFORM pg_temp.expect_setup_error('suspended actor denied',target,actor,'Suspended',true,'42501');
 UPDATE public.profiles SET account_status='inactive' WHERE id=actor;
 PERFORM pg_temp.expect_setup_error('inactive actor denied',target,actor,'Inactive',true,'42501');
 again:=public.bedos_setup_staff_invitation(target,second_actor,'Current admin reapproves',true);
 PERFORM pg_temp.check_setup('active admin may resume original creator inactive',again=invite);
 UPDATE public.profiles SET account_status='active' WHERE id=actor;
 PERFORM pg_temp.expect_setup_error('blank reason',target,actor,E'\t\n',true,'22023');
 PERFORM pg_temp.expect_setup_error('long reason',target,actor,repeat('x',501),true,'22023');
 PERFORM pg_temp.expect_setup_error('null resume flag',target,actor,'Invalid flag',NULL,'22023');
 fresh:=pg_temp.setup_fixture(actor,finance);
 PERFORM set_config('bedos.setup_test_target',fresh::text,true);PERFORM set_config('bedos.setup_test_action','staff_invitation_authorized',true);
 PERFORM pg_temp.expect_setup_error('approval audit failure',fresh,actor,'Atomic failure',true,'23514');
 PERFORM pg_temp.check_setup('audit failure rolls back profile',(SELECT role_id=customer_role AND full_name='Unconfigured' FROM public.profiles WHERE id=fresh));
 PERFORM pg_temp.check_setup('audit failure leaves no invitation',NOT EXISTS(SELECT 1 FROM public.staff_invitations WHERE user_id=fresh));
 PERFORM pg_temp.check_setup('Auth provenance retained on failure',EXISTS(SELECT 1 FROM auth.users WHERE id=fresh AND raw_app_meta_data ? 'bedos_staff_invitation'));
 PERFORM set_config('bedos.setup_test_action','staff_invitation_setup_resumed',true);
 PERFORM pg_temp.expect_setup_error('resume audit failure',fresh,actor,'Atomic second failure',true,'23514');
 PERFORM pg_temp.check_setup('resume audit rollback removes approval',NOT EXISTS(SELECT 1 FROM public.staff_invitations WHERE user_id=fresh) AND NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=fresh));
 PERFORM set_config('bedos.setup_test_target','',true);
 again:=public.bedos_setup_staff_invitation(fresh,actor,'Resume after failure',true);
 PERFORM pg_temp.check_setup('failure can be resumed',again IS NOT NULL AND (SELECT role_id=finance FROM public.profiles WHERE id=fresh));
 profile_fail:=pg_temp.setup_fixture(actor,finance);PERFORM set_config('bedos.setup_profile_target',profile_fail::text,true);
 PERFORM pg_temp.expect_setup_error('profile update failure',profile_fail,actor,'Atomic profile failure',false,'23514');
 PERFORM pg_temp.check_setup('profile failure leaves no approval',NOT EXISTS(SELECT 1 FROM public.staff_invitations WHERE user_id=profile_fail));
 PERFORM set_config('bedos.setup_profile_target','',true);
 PERFORM pg_temp.check_setup('profile failure can resume',public.bedos_setup_staff_invitation(profile_fail,actor,'Repair profile',true) IS NOT NULL);
 PERFORM public.bedos_revoke_staff_invitation(fresh,actor);
 PERFORM pg_temp.expect_setup_error('revoked invitation not reopened',fresh,actor,'No reopen',true,'P0001');
 UPDATE auth.users SET email_confirmed_at=now(),encrypted_password='synthetic-after-baseline' WHERE id=target;
 PERFORM public.bedos_activate_staff_invitation(target,actor);
 PERFORM pg_temp.expect_setup_error('activated invitation not reopened',target,actor,'No re-onboard',true,'P0001');
 legacy:=pg_temp.setup_fixture(actor,finance);UPDATE auth.users SET raw_app_meta_data='{}'::jsonb WHERE id=legacy;UPDATE public.profiles SET role_id=finance WHERE id=legacy;
 PERFORM public.bedos_authorize_staff_invitation(legacy,actor,finance);
 PERFORM pg_temp.expect_setup_error('legacy provenance not retrofitted',legacy,actor,'No retrofit',true,'42501');
 PERFORM pg_temp.check_setup('legacy trusted retry still available',(public.bedos_prepare_staff_invitation_retry(legacy,actor)->>'method')='invite');
 FOR entry IN SELECT id,name FROM public.roles WHERE name IN('content_manager','finance','sales_customer_service') LOOP
  fresh:=pg_temp.setup_fixture(actor,entry.id);
  again:=public.bedos_setup_staff_invitation(fresh,actor,'Ordinary role setup',false);
  PERFORM pg_temp.check_setup('setup bound role '||entry.name,again IS NOT NULL AND (SELECT role_id=entry.id AND account_status='inactive' FROM public.profiles WHERE id=fresh));
 END LOOP;
 EXECUTE 'SET LOCAL ROLE anon';BEGIN PERFORM public.bedos_setup_staff_invitation(profile_fail,actor,'forged',true);RAISE EXCEPTION 'Anon accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;EXECUTE 'RESET ROLE';PERFORM pg_temp.check_setup('anon forged actor invocation denied',true);
 EXECUTE 'SET LOCAL ROLE authenticated';BEGIN PERFORM public.bedos_setup_staff_invitation(profile_fail,actor,'forged',true);RAISE EXCEPTION 'Authenticated accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;EXECUTE 'RESET ROLE';PERFORM pg_temp.check_setup('authenticated forged actor invocation denied',true);
 EXECUTE 'SET LOCAL ROLE service_role';again:=public.bedos_setup_staff_invitation(profile_fail,actor,'Actual service',true);EXECUTE 'RESET ROLE';PERFORM pg_temp.check_setup('service actual execution',again IS NOT NULL);
END;$test$;
SELECT json_build_object('assertions',count(*)) FROM setup_checks;
