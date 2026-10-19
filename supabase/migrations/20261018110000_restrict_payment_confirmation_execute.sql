BEGIN;

-- Payment confirmation must only be executed by trusted backend code
-- after independently verifying the transaction with Paystack.

REVOKE EXECUTE
ON FUNCTION public.confirm_payment_and_order(uuid, uuid, timestamptz)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.confirm_payment_and_order(uuid, uuid, timestamptz)
TO service_role;

COMMIT;
