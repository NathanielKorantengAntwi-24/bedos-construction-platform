BEGIN;

CREATE FUNCTION public.bedos_create_customer_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    customer_role_id uuid;
BEGIN
    SELECT id INTO customer_role_id
    FROM public.roles
    WHERE name = 'customer';

    IF customer_role_id IS NULL THEN
        RAISE EXCEPTION 'Customer role is not configured';
    END IF;

    INSERT INTO public.profiles (
        id, full_name, phone, role_id, account_status
    )
    VALUES (
        NEW.id,
        NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
        NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data ->> 'phone'), ''),
        customer_role_id,
        'active'
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.bedos_create_customer_profile()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_bedos_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.bedos_create_customer_profile();

COMMIT;