BEGIN;

-- Preserve the legacy RPC while enforcing the same account restriction as
-- the backend profile API and ordinary profile RLS updates.
CREATE OR REPLACE FUNCTION public.update_own_profile(p_full_name text, p_phone text)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    updated_profile public.profiles;
BEGIN
    UPDATE public.profiles
    SET full_name = p_full_name,
        phone = p_phone,
        updated_at = pg_catalog.now()
    WHERE id = (SELECT auth.uid())
      AND account_status = 'active'
    RETURNING * INTO updated_profile;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active profile access required' USING ERRCODE = '42501';
    END IF;

    RETURN updated_profile;
END;
$function$;

COMMIT;
