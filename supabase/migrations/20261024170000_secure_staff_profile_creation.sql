BEGIN;

-- Verify that both expected triggers exist before changing anything.
DO $verification$
BEGIN
    -- The legacy trigger may be absent in fresh installations.
    -- If present, ensure it still calls the expected function.
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'auth.users'::regclass
          AND tgname = 'on_auth_user_created'
          AND NOT tgisinternal
          AND tgfoid IS DISTINCT FROM
              pg_catalog.to_regprocedure('public.handle_new_user()')
    ) THEN
        RAISE EXCEPTION 'Unexpected legacy profile trigger function';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'auth.users'::regclass
          AND tgname = 'on_bedos_auth_user_created'
          AND tgfoid = 'public.bedos_create_customer_profile()'::regprocedure
          AND tgenabled IN ('O', 'A')
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Expected Bedos profile trigger not found';
    END IF;
END;
$verification$;

-- Update the existing Bedos profile creation function.
CREATE OR REPLACE FUNCTION public.bedos_create_customer_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    customer_role_id uuid;
    initial_status text;
BEGIN
    SELECT id INTO customer_role_id
    FROM public.roles
    WHERE name = 'customer';

    IF customer_role_id IS NULL THEN
        RAISE EXCEPTION 'Customer role is not configured';
    END IF;

    -- User metadata must never grant elevated privileges.
    -- This marker can only restrict initial account access.
    initial_status := CASE
        WHEN NEW.raw_user_meta_data
            ->> 'bedos_staff_onboarding_pending' = 'true'
        THEN 'inactive'
        ELSE 'active'
    END;

    INSERT INTO public.profiles (
        id,
        full_name,
        phone,
        role_id,
        account_status
    )
    VALUES (
        NEW.id,
        NULLIF(
            pg_catalog.btrim(
                NEW.raw_user_meta_data ->> 'full_name'
            ),
            ''
        ),
        NULLIF(
            pg_catalog.btrim(
                NEW.raw_user_meta_data ->> 'phone'
            ),
            ''
        ),
        customer_role_id,
        initial_status
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.bedos_create_customer_profile()
FROM PUBLIC, anon, authenticated;

-- Remove the older duplicate trigger.
-- Keep the legacy function for now; only remove its trigger.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- The existing on_bedos_auth_user_created trigger remains.

COMMIT;