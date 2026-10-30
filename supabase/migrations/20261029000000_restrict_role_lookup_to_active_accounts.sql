BEGIN;

-- Existing RLS policies must stop granting role-based access as soon as an
-- account is restricted, including when its Auth session is still valid.
-- Preserve the function identity, owner and existing EXECUTE grants.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT r.name
    FROM public.profiles AS p
    JOIN public.roles AS r ON r.id = p.role_id
    WHERE p.id = (SELECT auth.uid())
      AND p.account_status = 'active';
$function$;

COMMIT;
