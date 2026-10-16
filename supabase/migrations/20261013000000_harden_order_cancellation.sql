
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  order_row public.orders%ROWTYPE;
  item_row record;
BEGIN
  -- Lock the order to serialize cancellation attempts.
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

  -- Never cancel while a payment may still complete,
  -- or while a successful payment lacks a refund workflow.
  IF EXISTS (
    SELECT 1
    FROM public.payments AS p
    WHERE p.order_id = p_order_id
      AND p.status IN ('pending', 'processing', 'paid')
  ) THEN
    RAISE EXCEPTION
      'Order cannot be cancelled while a payment is pending, processing, or paid';
  END IF;

  -- Restore reserved stock inside this transaction.
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

  UPDATE public.orders
  SET
    status = 'cancelled',
    updated_at = pg_catalog.now()
  WHERE id = p_order_id;

  RETURN p_order_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid)
TO service_role;
