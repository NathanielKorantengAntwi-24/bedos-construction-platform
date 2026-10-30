CREATE TEMP TABLE read_checks (name text PRIMARY KEY);
CREATE FUNCTION pg_temp.check_read(p_name text,p_pass boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF p_pass IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Assertion failed: %',p_name; END IF;
 INSERT INTO read_checks VALUES(p_name);
END; $$;
DO $test$
DECLARE
 actor uuid := gen_random_uuid(); target uuid := gen_random_uuid(); second_target uuid := gen_random_uuid();
 customer uuid; manager uuid; admin_role uuid; result jsonb; result2 jsonb; token text := gen_random_uuid()::text;
BEGIN
 SELECT id INTO customer FROM public.roles WHERE name='customer';
 SELECT id INTO manager FROM public.roles WHERE name='content_manager';
 SELECT id INTO admin_role FROM public.roles WHERE name='administrator';
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (actor,token||'-actor@bedos-user-reads.invalid','{"full_name":"Read test actor"}'),
 (target,token||'-one@bedos-user-reads.invalid','{"full_name":"Read test target"}'),
 (second_target,token||'-two@bedos-user-reads.invalid','{"full_name":"Read test second"}');
 UPDATE public.profiles SET role_id=admin_role,account_status='active' WHERE id=actor;
 UPDATE public.profiles SET role_id=customer,account_status='suspended',full_name=token||' literal_%\',created_at='2020-01-01' WHERE id=target;
 UPDATE public.profiles SET role_id=customer,account_status='active',full_name=token||' plain',created_at='2020-01-01' WHERE id=second_target;
 PERFORM pg_temp.check_read('service execute',has_function_privilege('service_role','public.bedos_read_users(uuid,uuid,integer,integer,text,text,text)','EXECUTE'));
 PERFORM pg_temp.check_read('anon denied',NOT has_function_privilege('anon','public.bedos_read_users(uuid,uuid,integer,integer,text,text,text)','EXECUTE'));
 PERFORM pg_temp.check_read('authenticated denied',NOT has_function_privilege('authenticated','public.bedos_read_users(uuid,uuid,integer,integer,text,text,text)','EXECUTE'));
 PERFORM pg_temp.check_read('definer empty path',EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.bedos_read_users(uuid,uuid,integer,integer,text,text,text)'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=""']));
 result := public.bedos_read_users(actor,p_q=>token,p_role=>'customer');
 PERFORM pg_temp.check_read('combined role search count',(result->>'total')::integer=2);
 PERFORM pg_temp.check_read('list count',(jsonb_array_length(result->'users'))=2);
 PERFORM pg_temp.check_read('list safe fields',(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(result->'users'->0) k)=ARRAY['account_status','created_at','email','full_name','id','phone','role','updated_at']);
 PERFORM pg_temp.check_read('role safe fields',(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(result->'users'->0->'role') k)=ARRAY['id','name']);
 result := public.bedos_read_users(actor,p_q=>token,p_role=>'customer',p_account_status=>'suspended');
 PERFORM pg_temp.check_read('combined status',(result->>'total')::integer=1 AND result->'users'->0->>'id'=target::text);
 result := public.bedos_read_users(actor,p_q=>'_%\');
 PERFORM pg_temp.check_read('literal wildcard escape',(result->>'total')::integer=1 AND result->'users'->0->>'id'=target::text);
 result := public.bedos_read_users(actor,p_q=>upper(token)||'-ONE@');
 PERFORM pg_temp.check_read('case insensitive email',(result->>'total')::integer=1 AND result->'users'->0->>'id'=target::text);
 result := public.bedos_read_users(actor,p_q=>token,p_role=>'customer',p_limit=>1);
 result2 := public.bedos_read_users(actor,p_q=>token,p_role=>'customer',p_limit=>1,p_page=>2);
 PERFORM pg_temp.check_read('stable tie order',(result->'users'->0->>'id') > (result2->'users'->0->>'id'));
 PERFORM pg_temp.check_read('consistent paged counts',(result->>'total')::integer=2 AND (result2->>'total')::integer=2);
 result := public.bedos_read_users(actor,p_q=>token,p_role=>'customer',p_page=>2147483647,p_limit=>100);
 PERFORM pg_temp.check_read('empty high page',result->'users'='[]'::jsonb AND (result->>'total')::integer=2);
 result := public.bedos_read_users(actor,p_user_id=>target);
 PERFORM pg_temp.check_read('detail selected identity',result->>'id'=target::text AND result->>'email'=token||'-one@bedos-user-reads.invalid');
 PERFORM pg_temp.check_read('detail no invitation',result->'invitation'='null'::jsonb);
 PERFORM pg_temp.check_read('absent detail',public.bedos_read_users(actor,p_user_id=>gen_random_uuid()) IS NULL);
 UPDATE public.profiles SET role_id=manager,account_status='inactive' WHERE id=second_target;
 PERFORM public.bedos_authorize_staff_invitation(second_target,actor,manager);
 result := public.bedos_read_users(actor,p_user_id=>second_target);
 PERFORM pg_temp.check_read('detail invitation summary',result->'invitation'->>'status'='pending' AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(result->'invitation') k)=ARRAY['activated_at','created_at','revoked_at','status']);
 BEGIN PERFORM public.bedos_read_users(gen_random_uuid()); RAISE EXCEPTION 'Missing actor accepted'; EXCEPTION WHEN insufficient_privilege THEN INSERT INTO read_checks VALUES('missing actor denied'); END;
 BEGIN PERFORM public.bedos_read_users(target); RAISE EXCEPTION 'Ordinary actor accepted'; EXCEPTION WHEN insufficient_privilege THEN INSERT INTO read_checks VALUES('ordinary actor denied'); END;
 UPDATE public.profiles SET account_status='suspended' WHERE id=actor;
 BEGIN PERFORM public.bedos_read_users(actor); RAISE EXCEPTION 'Suspended actor accepted'; EXCEPTION WHEN insufficient_privilege THEN INSERT INTO read_checks VALUES('suspended actor denied'); END;
 UPDATE public.profiles SET account_status='inactive' WHERE id=actor;
 BEGIN PERFORM public.bedos_read_users(actor); RAISE EXCEPTION 'Inactive actor accepted'; EXCEPTION WHEN insufficient_privilege THEN INSERT INTO read_checks VALUES('inactive actor denied'); END;
 UPDATE public.profiles SET account_status='active' WHERE id=actor;
 BEGIN PERFORM public.bedos_read_users(actor,p_limit=>101); RAISE EXCEPTION 'Invalid limit accepted'; EXCEPTION WHEN invalid_parameter_value THEN INSERT INTO read_checks VALUES('sql limit validation'); END;
 BEGIN PERFORM public.bedos_read_users(actor,p_role=>'owner'); RAISE EXCEPTION 'Invalid role accepted'; EXCEPTION WHEN invalid_parameter_value THEN INSERT INTO read_checks VALUES('sql role validation'); END;
 BEGIN PERFORM public.bedos_read_users(actor,p_q=>repeat('x',101)); RAISE EXCEPTION 'Long search accepted'; EXCEPTION WHEN invalid_parameter_value THEN INSERT INTO read_checks VALUES('sql search validation'); END;
 EXECUTE 'SET LOCAL ROLE anon';
 BEGIN PERFORM public.bedos_read_users(actor); RAISE EXCEPTION 'Anon forged actor accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_read('anon actual invocation denied',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.bedos_read_users(actor); RAISE EXCEPTION 'Authenticated forged actor accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_read('authenticated actual invocation denied',true);
 EXECUTE 'SET LOCAL ROLE service_role';
 result := public.bedos_read_users(actor,p_user_id=>target);
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.check_read('service actual invocation',result->>'id'=target::text);
END; $test$;
SELECT pg_temp.check_read('assertion count', (SELECT count(*) FROM read_checks)=28);
