-- Local isolated lab only, under a rollback-only runner transaction.
DO $test$
DECLARE
    fixture_user uuid := gen_random_uuid();
    other_user uuid := gen_random_uuid();
    fixture_status text;
    result_profile public.profiles;
    before_row public.profiles;
    after_row public.profiles;
    assertions integer := 0;
BEGIN
    INSERT INTO auth.users (id,email,raw_user_meta_data)
    VALUES (fixture_user,fixture_user::text || '@bedos-profile-rpc-test.invalid',
            '{"full_name":"Synthetic profile RPC test"}'::jsonb),
           (other_user,other_user::text || '@bedos-profile-rpc-test.invalid',
            '{"full_name":"Unrelated synthetic profile"}'::jsonb);

    PERFORM set_config('request.jwt.claim.sub', fixture_user::text, true);
    PERFORM set_config('request.jwt.claims',
        jsonb_build_object('sub', fixture_user, 'role', 'authenticated')::text, true);

    SELECT * INTO before_row FROM public.profiles WHERE id=fixture_user;
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT * INTO result_profile FROM public.update_own_profile('Updated synthetic profile','0000000000');
    IF result_profile.id <> fixture_user OR result_profile.full_name <> 'Updated synthetic profile'
       OR result_profile.phone <> '0000000000'
       OR result_profile.role_id IS DISTINCT FROM before_row.role_id
       OR result_profile.account_status <> 'active' THEN
        RAISE EXCEPTION 'Active customer profile update or protected-field integrity failed';
    END IF;
    assertions := assertions + 1;
    EXECUTE 'RESET ROLE';

    FOREACH fixture_status IN ARRAY ARRAY['inactive','suspended']
    LOOP
        UPDATE public.profiles SET account_status=fixture_status WHERE id=fixture_user;
        SELECT * INTO before_row FROM public.profiles WHERE id=fixture_user;
        EXECUTE 'SET LOCAL ROLE authenticated';
        BEGIN
            PERFORM public.update_own_profile('Forbidden change','1111111111');
            RAISE EXCEPTION 'Restricted account profile RPC unexpectedly succeeded: %',fixture_status;
        EXCEPTION WHEN insufficient_privilege THEN
            assertions := assertions + 1;
        END;
        EXECUTE 'RESET ROLE';
        SELECT * INTO after_row FROM public.profiles WHERE id=fixture_user;
        IF before_row IS DISTINCT FROM after_row THEN
            RAISE EXCEPTION 'Restricted profile was changed: %',fixture_status;
        END IF;
        assertions := assertions + 1;
    END LOOP;

    PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
        PERFORM public.update_own_profile('Missing profile','000');
        RAISE EXCEPTION 'Missing profile RPC unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        assertions := assertions + 1;
    END;
    EXECUTE 'RESET ROLE';

    PERFORM set_config('request.jwt.claim.sub','',true);
    PERFORM set_config('request.jwt.claims','{}',true);
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
        PERFORM public.update_own_profile('Anonymous change','000');
        RAISE EXCEPTION 'Anonymous profile RPC unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        assertions := assertions + 1;
    END;
    EXECUTE 'RESET ROLE';

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=other_user
                   AND full_name='Unrelated synthetic profile' AND phone IS NULL AND account_status='active') THEN
        RAISE EXCEPTION 'Another account was changed';
    END IF;
    assertions := assertions + 1;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p CROSS JOIN tested_function_before b
        WHERE p.oid='public.update_own_profile(text,text)'::regprocedure
          AND p.oid=b.function_oid AND p.proowner=b.owner_oid
          AND p.proacl IS NOT DISTINCT FROM b.function_acl
          AND p.prosecdef AND p.prorettype='public.profiles'::regtype
          AND p.proconfig @> ARRAY['search_path=""']
    ) THEN
        RAISE EXCEPTION 'Profile RPC identity, ACL, type or search_path regression';
    END IF;
    assertions := assertions + 1;
    RAISE NOTICE 'PASS: % profile RPC assertions; active, inactive, suspended, anonymous, missing profile, isolation and compatibility',assertions;
END;
$test$;
