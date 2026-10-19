BEGIN;

-- Order creation must pass through the trusted Bedos backend,
-- which authenticates the customer and validates the request.

REVOKE EXECUTE
ON FUNCTION public.create_order(uuid, jsonb, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.create_order(uuid, jsonb, text, text)
TO service_role;

-- Direct stock reservation must not be available to public clients.
-- Inventory reservations are managed by trusted backend operations.

REVOKE EXECUTE
ON FUNCTION public.reserve_product_stock(uuid, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.reserve_product_stock(uuid, integer)
TO service_role;

COMMIT;
