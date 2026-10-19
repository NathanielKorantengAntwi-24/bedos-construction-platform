BEGIN;

-- Order cancellation must only be executed by trusted backend code
-- after the API verifies the user's authorization.

REVOKE EXECUTE
ON FUNCTION public.cancel_order(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.cancel_order(uuid)
TO service_role;

COMMIT;
