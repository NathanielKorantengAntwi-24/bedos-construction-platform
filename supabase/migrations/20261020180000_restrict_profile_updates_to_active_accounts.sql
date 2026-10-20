BEGIN;

-- Only active users may update their own profile.
-- Existing column-level privileges continue to protect
-- id, role_id and account_status.

ALTER POLICY "Users can update their own profile"
ON public.profiles
USING (
    id = (SELECT auth.uid())
    AND account_status = 'active'
)
WITH CHECK (
    id = (SELECT auth.uid())
    AND account_status = 'active'
);

COMMIT;