
CREATE OR REPLACE FUNCTION public.confirm_payment_and_order(
  p_payment_id uuid,
  p_customer_id uuid,
  p_paid_at timestamp with time zone
)
RETURNS TABLE(
  payment_id uuid,
  order_id uuid,
  customer_id uuid,
  order_number text,
  payment_status text,
  order_status text,
  paid_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  payment_row public.payments%ROWTYPE;
  order_row public.orders%ROWTYPE;
  confirmed_paid_at timestamptz;
BEGIN
  SELECT p.*
  INTO payment_row
  FROM public.payments AS p
  WHERE p.id = p_payment_id
    AND p.customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  SELECT o.*
  INTO order_row
  FROM public.orders AS o
  WHERE o.id = payment_row.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Ensure the payment belongs to the order's customer.
  IF order_row.customer_id IS DISTINCT FROM payment_row.customer_id THEN
    RAISE EXCEPTION 'Payment customer does not match order customer';
  END IF;

  -- Idempotent retry: do not confirm a payment twice.
  IF payment_row.status = 'paid' THEN
    RETURN QUERY
    SELECT
      payment_row.id,
      order_row.id,
      payment_row.customer_id,
      order_row.order_number,
      payment_row.status,
      order_row.status,
      payment_row.paid_at;
    RETURN;
  END IF;

  -- Only verified pending/processing payments are eligible.
  IF payment_row.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Payment is not eligible for confirmation';
  END IF;

  IF order_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Order is not pending';
  END IF;

  confirmed_paid_at := COALESCE(p_paid_at, pg_catalog.now());

  UPDATE public.payments
  SET
    status = 'paid',
    paid_at = confirmed_paid_at,
    updated_at = pg_catalog.now()
  WHERE id = payment_row.id;

  UPDATE public.orders
  SET
    status = 'confirmed',
    updated_at = pg_catalog.now()
  WHERE id = order_row.id;

  RETURN QUERY
  SELECT
    payment_row.id,
    order_row.id,
    payment_row.customer_id,
    order_row.order_number,
    'paid'::text,
    'confirmed'::text,
    confirmed_paid_at;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirm_payment_and_order(uuid, uuid, timestamp with time zone)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_payment_and_order(uuid, uuid, timestamp with time zone)
TO service_role;

-- Restrict cancellation to trusted server-side operations.
REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid)
TO service_role;
