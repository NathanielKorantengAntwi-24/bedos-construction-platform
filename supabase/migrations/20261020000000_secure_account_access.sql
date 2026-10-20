BEGIN;

-- Remove excessive privileges from client-facing roles.
REVOKE ALL PRIVILEGES
ON TABLE
  public.profiles,
  public.roles,
  public.permissions,
  public.role_permissions
FROM PUBLIC, anon, authenticated;

-- Preserve trusted backend administrative operations.
GRANT ALL PRIVILEGES
ON TABLE
  public.profiles,
  public.roles,
  public.permissions,
  public.role_permissions
TO service_role;

-- Allow authenticated users to read records as permitted by RLS.
GRANT SELECT
ON TABLE
  public.profiles,
  public.roles,
  public.permissions,
  public.role_permissions
TO authenticated;

-- Customers may update only ordinary profile fields.
-- The existing RLS policy restricts updates to their own row.
GRANT UPDATE (full_name, phone)
ON TABLE public.profiles
TO authenticated;

COMMIT;