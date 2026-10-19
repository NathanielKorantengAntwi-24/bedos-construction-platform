BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_payment_refund(
    p_payment_id uuid,
    p_initiated_by uuid,
    p_reason text
)
RETURNS SETOF public.payment_refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    payment_order_id uuid;
    payment_row public.payments%ROWTYPE;
    order_row public.orders%ROWTYPE;
    refund_row public.payment_refunds%ROWTYPE;
    actor_status text;
    actor_role text;
    actor_has_permission boolean;
BEGIN
    IF p_payment_id IS NULL OR p_initiated_by IS NULL THEN
        RAISE EXCEPTION 'Payment and initiating user are required';
    END IF;

    IF p_reason IS NULL
       OR pg_catalog.length(pg_catalog.btrim(p_reason)) < 3
       OR pg_catalog.length(pg_catalog.btrim(p_reason)) > 1000 THEN
        RAISE EXCEPTION 'Refund reason must contain 3 to 1000 characters';
    END IF;

    -- Discover the order first; lock order before locking payment.
    SELECT p.order_id
    INTO payment_order_id
    FROM public.payments AS p
    WHERE p.id = p_payment_id
      AND p.provider = 'paystack';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Paystack payment not found';
    END IF;

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
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found';
    END IF;

    IF payment_row.order_id IS DISTINCT FROM payment_order_id
       OR payment_row.customer_id IS DISTINCT FROM order_row.customer_id THEN
        RAISE EXCEPTION 'Payment and order customer details do not match';
    END IF;

    -- Enforce the existing permission as well as the expected roles.
    SELECT
        profile.account_status,
        user_role.name,
        EXISTS (
            SELECT 1
            FROM public.role_permissions AS rp
            JOIN public.permissions AS perm
              ON perm.id = rp.permission_id
            WHERE rp.role_id = profile.role_id
              AND perm.name = 'payments.manage'
        )
    INTO actor_status, actor_role, actor_has_permission
    FROM public.profiles AS profile
    JOIN public.roles AS user_role
      ON user_role.id = profile.role_id
    WHERE profile.id = p_initiated_by;

    IF NOT FOUND
       OR actor_status IS DISTINCT FROM 'active'
       OR actor_role NOT IN ('administrator', 'finance')
       OR actor_has_permission IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Active finance or administrator permission is required';
    END IF;

    IF payment_row.status <> 'paid'
       OR payment_row.provider_reference IS NULL
       OR pg_catalog.btrim(payment_row.provider_reference) = '' THEN
        RAISE EXCEPTION 'Only verified paid payments can be refunded';
    END IF;

    IF order_row.status NOT IN ('confirmed', 'processing', 'ready') THEN
        RAISE EXCEPTION 'Only eligible unfulfilled orders can be refunded';
    END IF;

    IF payment_row.amount IS DISTINCT FROM order_row.total_amount
       OR payment_row.currency IS DISTINCT FROM order_row.currency
       OR payment_row.amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount or currency does not match the order';
    END IF;

    -- Conservative first version: never create a second refund request
    -- automatically for a payment that already has a refund record.
    IF EXISTS (
        SELECT 1
        FROM public.payment_refunds AS pr
        WHERE pr.payment_id = p_payment_id
    ) THEN
        RAISE EXCEPTION
            'A refund record already exists; reconcile it before any further action';
    END IF;

    INSERT INTO public.payment_refunds (
        payment_id,
        order_id,
        provider_transaction_reference,
        amount,
        currency,
        status,
        reason,
        initiated_by
    )
    VALUES (
        payment_row.id,
        order_row.id,
        payment_row.provider_reference,
        payment_row.amount,
        payment_row.currency,
        'initiating',
        pg_catalog.btrim(p_reason),
        p_initiated_by
    )
    RETURNING * INTO refund_row;

    RETURN NEXT refund_row;
    RETURN;
END;
$function$;

REVOKE ALL PRIVILEGES
ON FUNCTION public.reserve_payment_refund(uuid, uuid, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.reserve_payment_refund(uuid, uuid, text)
TO service_role;

COMMIT;
