BEGIN;

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

  -- An already-paid payment must not reset an advancing order.
  -- Accept legitimate duplicate confirmations without modifying state.
  IF payment_row.status = 'paid' THEN
    IF order_row.status NOT IN (
      'confirmed',
      'processing',
      'ready',
      'completed'
    ) THEN
      RAISE EXCEPTION
        'Paid payment has an inconsistent order status';
    END IF;

    IF payment_row.amount IS DISTINCT FROM order_row.total_amount
       OR payment_row.currency IS DISTINCT FROM order_row.currency
       OR payment_row.paid_at IS NULL THEN
      RAISE EXCEPTION
        'Paid payment has inconsistent financial details';
    END IF;

    -- Create the in-app confirmation as part of the payment transaction.
    -- The partial unique index prevents duplicate notifications.
    INSERT INTO public.notifications (
      recipient_id,
      notification_type,
      title,
      message,
      channel,
      status,
      related_entity_type,
      related_entity_id
    )
    VALUES (
      payment_row.customer_id,
      'order_confirmed',
      'Order confirmed',
      pg_catalog.format(
        'Your order %s has been confirmed.',
        order_row.order_number
      ),
      'in_app',
      'pending',
      'order',
      order_row.id
    )
    ON CONFLICT (
      recipient_id,
      notification_type,
      related_entity_id
    )
    WHERE notification_type = 'order_confirmed'
      AND related_entity_type = 'order'
    DO NOTHING;
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

  -- Create the in-app confirmation as part of the payment transaction.
  -- The partial unique index prevents duplicate notifications.
  INSERT INTO public.notifications (
    recipient_id,
    notification_type,
    title,
    message,
    channel,
    status,
    related_entity_type,
    related_entity_id
  )
  VALUES (
    payment_row.customer_id,
    'order_confirmed',
    'Order confirmed',
    pg_catalog.format(
      'Your order %s has been confirmed.',
      order_row.order_number
    ),
    'in_app',
    'pending',
    'order',
    order_row.id
  )
  ON CONFLICT (
    recipient_id,
    notification_type,
    related_entity_id
  )
  WHERE notification_type = 'order_confirmed'
    AND related_entity_type = 'order'
  DO NOTHING;
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

-- Only the trusted backend may confirm payments after Paystack verification.
REVOKE EXECUTE
ON FUNCTION public.confirm_payment_and_order(uuid, uuid, timestamptz)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.confirm_payment_and_order(uuid, uuid, timestamptz)
TO service_role;
COMMIT;
