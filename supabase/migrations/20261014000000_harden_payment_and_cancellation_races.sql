
-- Coordinated payment reservation, confirmation, and cancellation.
-- Local review only: do not apply until approved.

CREATE OR REPLACE FUNCTION public.reserve_payment_attempt(
  p_order_id uuid,
  p_customer_id uuid,
  p_provider_reference text
)
RETURNS TABLE (
  id uuid,
  order_id uuid,
  customer_id uuid,
  provider text,
  provider_reference text,
  amount numeric,
  currency text,
  status text,
  paid_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  order_row public.orders%ROWTYPE;
  payment_row public.payments%ROWTYPE;
BEGIN
  -- All payment lifecycle operations lock the order first.
  SELECT o.*
  INTO order_row
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF order_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending orders can be paid';
  END IF;

  IF order_row.total_amount IS NULL
     OR order_row.total_amount <= 0
     OR order_row.total_amount * 100
        <> pg_catalog.trunc(order_row.total_amount * 100)
     OR order_row.total_amount * 100 > 9007199254740991 THEN
    RAISE EXCEPTION
      'Order amount must be positive, have at most two decimal places, and fit safely in pesewas';
  END IF;

  IF order_row.currency IS NULL
     OR pg_catalog.btrim(order_row.currency) = '' THEN
    RAISE EXCEPTION 'Order currency is required';
  END IF;

  IF p_provider_reference IS NULL
     OR pg_catalog.btrim(p_provider_reference) = '' THEN
    RAISE EXCEPTION 'Payment reference is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments AS p
    WHERE p.order_id = p_order_id
      AND p.status = 'paid'
  ) THEN
    RAISE EXCEPTION 'This order has already been paid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments AS p
    WHERE p.order_id = p_order_id
      AND p.status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'A payment is already in progress for this order';
  END IF;

  INSERT INTO public.payments (
    order_id,
    customer_id,
    provider,
    provider_reference,
    amount,
    currency,
    status
  )
  VALUES (
    order_row.id,
    order_row.customer_id,
    'paystack',
    p_provider_reference,
    order_row.total_amount,
    order_row.currency,
    'processing'
  )
  RETURNING * INTO payment_row;

  RETURN QUERY
  SELECT
    payment_row.id,
    payment_row.order_id,
    payment_row.customer_id,
    payment_row.provider,
    payment_row.provider_reference,
    payment_row.amount,
    payment_row.currency,
    payment_row.status,
    payment_row.paid_at,
    payment_row.created_at,
    payment_row.updated_at;
END;
$function$;


CREATE OR REPLACE FUNCTION public.confirm_payment_and_order(
  p_payment_id uuid,
  p_customer_id uuid,
  p_paid_at timestamptz
)
RETURNS TABLE (
  payment_id uuid,
  order_id uuid,
  customer_id uuid,
  order_number text,
  payment_status text,
  order_status text,
  paid_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  payment_order_id uuid;
  payment_row public.payments%ROWTYPE;
  order_row public.orders%ROWTYPE;
  confirmed_paid_at timestamptz;
BEGIN
  -- Discover the order without locking the payment first.
  SELECT p.order_id
  INTO payment_order_id
  FROM public.payments AS p
  WHERE p.id = p_payment_id
    AND p.customer_id = p_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  -- Consistent lock order: order, then payment.
  SELECT o.*
  INTO order_row
  FROM public.orders AS o
  WHERE o.id = payment_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT p.*
  INTO payment_row
  FROM public.payments AS p
  WHERE p.id = p_payment_id
    AND p.customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF payment_row.order_id IS DISTINCT FROM payment_order_id
     OR order_row.customer_id IS DISTINCT FROM payment_row.customer_id THEN
    RAISE EXCEPTION 'Payment customer does not match order customer';
  END IF;

  -- A paid payment is idempotent only if its order is confirmed.
  IF payment_row.status = 'paid' THEN
    IF order_row.status <> 'confirmed' THEN
      RAISE EXCEPTION
        'Paid payment has an inconsistent order status';
    END IF;

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

  IF payment_row.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Payment is not eligible for confirmation';
  END IF;

  IF order_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Order is not pending';
  END IF;

  -- A successful confirmation must use the database's order amount
  -- and currency; the application separately verifies Paystack's values.
  IF payment_row.amount IS DISTINCT FROM order_row.total_amount
     OR payment_row.currency IS DISTINCT FROM order_row.currency THEN
    RAISE EXCEPTION 'Payment amount or currency does not match order';
  END IF;

  confirmed_paid_at := COALESCE(p_paid_at, pg_catalog.now());

  UPDATE public.payments AS p
  SET
    status = 'paid',
    paid_at = confirmed_paid_at,
    updated_at = pg_catalog.now()
  WHERE p.id = payment_row.id;

  UPDATE public.orders AS o
  SET
    status = 'confirmed',
    updated_at = pg_catalog.now()
  WHERE o.id = order_row.id;

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


CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  order_row public.orders%ROWTYPE;
  item_row record;
BEGIN
  SELECT o.*
  INTO order_row
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF order_row.status NOT IN (
    'pending',
    'confirmed',
    'processing',
    'ready'
  ) THEN
    RAISE EXCEPTION
      'Order cannot be cancelled from status %',
      order_row.status;
  END IF;

  -- Reservation and confirmation lock the same order first.
  IF EXISTS (
    SELECT 1
    FROM public.payments AS p
    WHERE p.order_id = p_order_id
      AND p.status IN ('pending', 'processing', 'paid')
  ) THEN
    RAISE EXCEPTION
      'Order cannot be cancelled while a payment is pending, processing, or paid';
  END IF;

  -- Restore stock and cancel in the same transaction.
  FOR item_row IN
    SELECT oi.product_id, oi.quantity
    FROM public.order_items AS oi
    WHERE oi.order_id = p_order_id
  LOOP
    UPDATE public.products AS pr
    SET
      stock_quantity = pr.stock_quantity + item_row.quantity,
      updated_at = pg_catalog.now()
    WHERE pr.id = item_row.product_id;
  END LOOP;

  UPDATE public.orders AS o
  SET
    status = 'cancelled',
    updated_at = pg_catalog.now()
  WHERE o.id = p_order_id;

  RETURN p_order_id;
END;
$function$;


-- These functions are privileged server-side operations only.
REVOKE EXECUTE ON FUNCTION public.reserve_payment_attempt(uuid, uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_payment_attempt(uuid, uuid, text)
TO service_role;

REVOKE EXECUTE ON FUNCTION public.confirm_payment_and_order(uuid, uuid, timestamptz)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_payment_and_order(uuid, uuid, timestamptz)
TO service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid)
TO service_role;
