-- Restrict direct access to payment records.
-- Payment mutations must use trusted server-side services and RPCs.

BEGIN;

REVOKE ALL PRIVILEGES
ON TABLE public.payments
FROM PUBLIC, anon, authenticated;

GRANT SELECT
ON TABLE public.payments
TO authenticated;

DROP POLICY IF EXISTS
"Finance can manage payments"
ON public.payments;

COMMIT;
