-- Run only through scripts/Test-ActiveAccountRoleHelper.ps1 in the local lab.
-- The runner supplies a transaction and rolls back fixtures and the migration.
DO $test$
DECLARE
    fixture_user uuid := gen_random_uuid();
    fixture_draft uuid := gen_random_uuid();
    fixture_published uuid := gen_random_uuid();
    fixture_role record;
    fixture_status text;
    actual_role text;
    visible_count bigint;
    changed_count bigint;
    expected_count bigint;
    assertion_count integer := 0;
    expected_signature oid;
    expected_owner oid;
    expected_acl aclitem[];
BEGIN
    SELECT function_oid, owner_oid, function_acl
    INTO expected_signature, expected_owner, expected_acl
    FROM tested_function_before;

    IF (SELECT count(*) FROM public.roles WHERE name IN
        ('administrator', 'content_manager', 'customer', 'finance', 'sales_customer_service')) <> 5 THEN
        RAISE EXCEPTION 'The isolated lab must contain all five expected roles';
    END IF;

    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (fixture_user, fixture_user::text || '@bedos-role-test.invalid',
            '{"full_name":"Synthetic role helper test"}'::jsonb);

    INSERT INTO public.services (id, name, slug, status)
    VALUES (fixture_draft, 'Synthetic role helper draft', fixture_draft::text, 'draft'),
           (fixture_published, 'Synthetic role helper published', fixture_published::text, 'published');

    -- Keep the same JWT subject while changing the stored account status.
    -- This models an existing session surviving suspension/deactivation.
    PERFORM set_config('request.jwt.claim.sub', fixture_user::text, true);
    PERFORM set_config('request.jwt.claims',
        jsonb_build_object('sub', fixture_user, 'role', 'authenticated')::text, true);

    FOR fixture_role IN
        SELECT id, name FROM public.roles WHERE name IN
            ('administrator', 'content_manager', 'customer', 'finance', 'sales_customer_service')
        ORDER BY name
    LOOP
        FOREACH fixture_status IN ARRAY ARRAY['active', 'inactive', 'suspended']
        LOOP
            UPDATE public.profiles SET role_id = fixture_role.id, account_status = fixture_status
            WHERE id = fixture_user;

            EXECUTE 'SET LOCAL ROLE authenticated';
            SELECT public.get_user_role() INTO actual_role;
            IF actual_role IS DISTINCT FROM
               (CASE WHEN fixture_status = 'active' THEN fixture_role.name ELSE NULL END) THEN
                RAISE EXCEPTION 'Role lookup failed: role=%, status=%, actual=%',
                    fixture_role.name, fixture_status, actual_role;
            END IF;
            assertion_count := assertion_count + 1;

            SELECT count(*) INTO visible_count FROM public.services
            WHERE id IN (fixture_draft, fixture_published);
            expected_count := CASE
                WHEN fixture_status <> 'active' THEN 0
                WHEN fixture_role.name IN ('administrator', 'content_manager') THEN 2
                WHEN fixture_role.name = 'customer' THEN 1
                ELSE 0 END;
            IF visible_count <> expected_count THEN
                RAISE EXCEPTION 'RLS read failed: role=%, status=%, expected=%, actual=%',
                    fixture_role.name, fixture_status, expected_count, visible_count;
            END IF;
            assertion_count := assertion_count + 1;

            UPDATE public.services SET description = 'Synthetic permitted update'
            WHERE id = fixture_draft;
            GET DIAGNOSTICS changed_count = ROW_COUNT;
            expected_count := CASE
                WHEN fixture_status = 'active' AND
                     fixture_role.name IN ('administrator', 'content_manager') THEN 1
                ELSE 0 END;
            IF changed_count <> expected_count THEN
                RAISE EXCEPTION 'RLS update failed: role=%, status=%, expected=%, actual=%',
                    fixture_role.name, fixture_status, expected_count, changed_count;
            END IF;
            assertion_count := assertion_count + 1;
            EXECUTE 'RESET ROLE';
        END LOOP;
    END LOOP;

    -- A signed-in user without a profile must not inherit any role.
    PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF public.get_user_role() IS NOT NULL THEN
        RAISE EXCEPTION 'Missing profile returned a role';
    END IF;
    assertion_count := assertion_count + 1;
    EXECUTE 'RESET ROLE';

    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '{}', true);
    EXECUTE 'SET LOCAL ROLE anon';
    IF public.get_user_role() IS NOT NULL THEN
        RAISE EXCEPTION 'Anonymous caller returned a role';
    END IF;
    assertion_count := assertion_count + 1;
    EXECUTE 'RESET ROLE';

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.get_user_role()'::regprocedure
          AND oid = expected_signature AND proowner = expected_owner
          AND proacl IS NOT DISTINCT FROM expected_acl
          AND prosecdef AND provolatile = 's' AND prorettype = 'text'::regtype
    ) THEN
        RAISE EXCEPTION 'Function identity, owner, ACL or attributes changed unexpectedly';
    END IF;
    assertion_count := assertion_count + 1;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.get_user_role()'::regprocedure
          AND proconfig @> ARRAY['search_path=""']
    ) THEN
        RAISE EXCEPTION 'Function search_path is not locked to an empty value';
    END IF;
    assertion_count := assertion_count + 1;

    RAISE NOTICE 'PASS: % database assertions (five roles, three statuses, RLS reads/writes, missing profile, anonymous and function compatibility)', assertion_count;
END;
$test$;
