BEGIN;

-- Only trusted backend code may reserve payment attempts.
-- The API must authenticate the customer and obtain their ID
-- from the verified session before invoking this function.

REVOKE EXECUTE
ON FUNCTION public.reserve_payment_attempt(uuid, uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.reserve_payment_attempt(uuid, uuid, text)
TO service_role;

COMMIT;
