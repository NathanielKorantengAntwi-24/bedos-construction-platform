BEGIN;

CREATE OR REPLACE FUNCTION public.update_payment_refund_status(
    p_provider_transaction_reference text,
    p_status text,
    p_amount_subunit bigint,
    p_currency text,
    p_provider_status text DEFAULT NULL,
    p_provider_refund_id text DEFAULT NULL,
    p_failure_code text DEFAULT NULL
)
RETURNS public.payment_refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    lookup_refund public.payment_refunds%ROWTYPE;
    refund_row public.payment_refunds%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    order_row public.orders%ROWTYPE;
    provider_refund_id_value text :=
        NULLIF(pg_catalog.btrim(p_provider_refund_id), '');
    transition_allowed boolean := false;
BEGIN
    IF p_provider_transaction_reference IS NULL
       OR pg_catalog.btrim(p_provider_transaction_reference) = '' THEN
        RAISE EXCEPTION 'Provider transaction reference is required';
    END IF;
    IF p_amount_subunit IS NULL
       OR p_amount_subunit <= 0
       OR p_currency IS NULL
       OR pg_catalog.btrim(p_currency) = '' THEN
        RAISE EXCEPTION 'Refund amount and currency are required';
    END IF;

    IF p_status IS NULL OR p_status NOT IN (
        'pending',
        'processing',
        'needs_attention',
        'failed',
        'rejected',
        'outcome_unknown'
    ) THEN
        RAISE EXCEPTION 'Invalid non-final refund status';
    END IF;

    IF p_provider_status IS NOT NULL
       AND p_provider_status NOT IN (
           'pending',
           'processing',
           'needs-attention',
           'failed'
       ) THEN
        RAISE EXCEPTION 'Invalid provider refund status';
    END IF;

    IF (p_status = 'pending'
        AND p_provider_status IS DISTINCT FROM 'pending')
       OR (p_status = 'processing'
        AND p_provider_status IS DISTINCT FROM 'processing')
       OR (p_status = 'needs_attention'
        AND p_provider_status IS DISTINCT FROM 'needs-attention')
       OR (p_status = 'failed'
        AND p_provider_status IS DISTINCT FROM 'failed')
       OR (p_status IN ('rejected', 'outcome_unknown')
        AND p_provider_status IS NOT NULL) THEN
        RAISE EXCEPTION 'Refund status mapping is inconsistent';
    END IF;

    -- Resolve the refund before locking rows. Use the consistent
    -- lock order: order, payment, then refund.
    SELECT pr.*
    INTO lookup_refund
    FROM public.payment_refunds AS pr
    JOIN public.payments AS p
      ON p.id = pr.payment_id
    WHERE p.provider = 'paystack'
      AND p.provider_reference = p_provider_transaction_reference
      AND pr.provider_transaction_reference =
          p_provider_transaction_reference;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund record not found';
    END IF;

    SELECT o.*
    INTO order_row
    FROM public.orders AS o
    WHERE o.id = lookup_refund.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund order not found';
    END IF;

    SELECT p.*
    INTO payment_row
    FROM public.payments AS p
    WHERE p.id = lookup_refund.payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund payment not found';
    END IF;

    SELECT pr.*
    INTO refund_row
    FROM public.payment_refunds AS pr
    WHERE pr.id = lookup_refund.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund record not found';
    END IF;

    IF payment_row.provider_reference IS DISTINCT FROM
           p_provider_transaction_reference
       OR payment_row.order_id IS DISTINCT FROM order_row.id
       OR payment_row.customer_id IS DISTINCT FROM order_row.customer_id
       OR refund_row.payment_id IS DISTINCT FROM payment_row.id
       OR refund_row.order_id IS DISTINCT FROM order_row.id THEN
        RAISE EXCEPTION 'Refund, payment, and order do not match';
    END IF;

    IF payment_row.amount IS DISTINCT FROM order_row.total_amount
       OR payment_row.currency IS DISTINCT FROM order_row.currency
       OR payment_row.amount IS DISTINCT FROM refund_row.amount
       OR payment_row.currency IS DISTINCT FROM refund_row.currency
       OR payment_row.amount <= 0
       OR payment_row.amount * 100 <>
          pg_catalog.trunc(payment_row.amount * 100)
       OR p_amount_subunit::numeric <>
          payment_row.amount * 100
       OR p_currency IS DISTINCT FROM payment_row.currency THEN
        RAISE EXCEPTION 'Refund amount or currency mismatch';
    END IF;

    IF provider_refund_id_value IS NOT NULL
       AND refund_row.provider_refund_id IS NOT NULL
       AND refund_row.provider_refund_id IS DISTINCT FROM
           provider_refund_id_value THEN
        RAISE EXCEPTION 'Provider refund ID mismatch';
    END IF;

    -- Final states cannot be downgraded by late webhook events.
    IF refund_row.status = 'processed' THEN
        IF payment_row.status <> 'refunded'
           OR order_row.status <> 'cancelled'
           OR refund_row.processed_at IS NULL THEN
            RAISE EXCEPTION 'Processed refund has inconsistent records';
        END IF;

        -- Save the refund ID if the API response arrives after the webhook.
        -- Do not change the completed refund's financial state.
        IF provider_refund_id_value IS NOT NULL
           AND refund_row.provider_refund_id IS NULL
           AND p_status IN ('pending', 'processing', 'needs_attention') THEN

            UPDATE public.payment_refunds AS pr
            SET
                provider_refund_id = provider_refund_id_value,
                updated_at = pg_catalog.now()
            WHERE pr.id = refund_row.id
              AND pr.status = 'processed'
              AND pr.provider_refund_id IS NULL
            RETURNING pr.* INTO refund_row;
        END IF;

        RETURN refund_row;
    END IF;

    -- Refund progress must not rewrite the original payment result.
    IF payment_row.status <> 'paid' THEN
        RAISE EXCEPTION 'Payment is not eligible for refund updates';
    END IF;

    CASE refund_row.status
        WHEN 'initiating' THEN
            transition_allowed := true;

        WHEN 'outcome_unknown' THEN
            transition_allowed := p_status IN (
                'outcome_unknown',
                'pending',
                'processing',
                'needs_attention',
                'failed',
                'rejected'
            );

        WHEN 'pending' THEN
            transition_allowed := p_status IN (
                'pending',
                'processing',
                'needs_attention',
                'failed'
            );

        WHEN 'processing' THEN
            transition_allowed := p_status IN (
                'processing',
                'needs_attention',
                'failed'
            );

        WHEN 'needs_attention' THEN
            transition_allowed := p_status IN (
                'needs_attention',
                'processing',
                'failed'
            );

        WHEN 'failed' THEN
            transition_allowed := p_status = 'failed';

        WHEN 'rejected' THEN
            transition_allowed := p_status = 'rejected';

        ELSE
            transition_allowed := false;
    END CASE;

    -- Ignore stale or out-of-order events without changing state.
    IF NOT transition_allowed THEN
        RETURN refund_row;
    END IF;

    UPDATE public.payment_refunds AS pr
    SET
        status = p_status,
        provider_status = COALESCE(
            p_provider_status,
            pr.provider_status
        ),
        provider_refund_id = COALESCE(
            provider_refund_id_value,
            pr.provider_refund_id
        ),
        failure_code = COALESCE(
            NULLIF(pg_catalog.btrim(p_failure_code), ''),
            pr.failure_code
        ),
        updated_at = pg_catalog.now()
    WHERE pr.id = refund_row.id
    RETURNING pr.* INTO refund_row;

    RETURN refund_row;
END;
$function$;


CREATE OR REPLACE FUNCTION public.complete_payment_refund(
    p_provider_transaction_reference text,
    p_provider_refund_id text,
    p_amount_subunit bigint,
    p_currency text
)
RETURNS public.payment_refunds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    lookup_refund public.payment_refunds%ROWTYPE;
    refund_row public.payment_refunds%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    order_row public.orders%ROWTYPE;
    item_row record;
    provider_refund_id_value text :=
        NULLIF(pg_catalog.btrim(p_provider_refund_id), '');
BEGIN
    IF p_provider_transaction_reference IS NULL
       OR pg_catalog.btrim(p_provider_transaction_reference) = ''
       OR p_amount_subunit IS NULL
       OR p_amount_subunit <= 0
       OR p_currency IS NULL
       OR pg_catalog.btrim(p_currency) = '' THEN
        RAISE EXCEPTION 'Refund reference, amount, and currency are required';
    END IF;

    SELECT pr.*
    INTO lookup_refund
    FROM public.payment_refunds AS pr
    JOIN public.payments AS p
      ON p.id = pr.payment_id
    WHERE p.provider = 'paystack'
      AND p.provider_reference = p_provider_transaction_reference
      AND pr.provider_transaction_reference =
          p_provider_transaction_reference;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund record not found';
    END IF;

    -- Lock order, payment, then refund, matching other payment RPCs.
    SELECT o.*
    INTO order_row
    FROM public.orders AS o
    WHERE o.id = lookup_refund.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund order not found';
    END IF;

    SELECT p.*
    INTO payment_row
    FROM public.payments AS p
    WHERE p.id = lookup_refund.payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund payment not found';
    END IF;

    SELECT pr.*
    INTO refund_row
    FROM public.payment_refunds AS pr
    WHERE pr.id = lookup_refund.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Refund record not found';
    END IF;

    IF payment_row.provider_reference IS DISTINCT FROM
           p_provider_transaction_reference
       OR payment_row.order_id IS DISTINCT FROM order_row.id
       OR payment_row.customer_id IS DISTINCT FROM order_row.customer_id
       OR refund_row.payment_id IS DISTINCT FROM payment_row.id
       OR refund_row.order_id IS DISTINCT FROM order_row.id THEN
        RAISE EXCEPTION 'Refund, payment, and order do not match';
    END IF;

    IF payment_row.provider <> 'paystack'
       OR payment_row.amount IS DISTINCT FROM order_row.total_amount
       OR payment_row.currency IS DISTINCT FROM order_row.currency
       OR payment_row.amount IS DISTINCT FROM refund_row.amount
       OR payment_row.currency IS DISTINCT FROM refund_row.currency
       OR payment_row.amount <= 0
       OR payment_row.amount * 100 <>
          pg_catalog.trunc(payment_row.amount * 100)
       OR p_amount_subunit::numeric <>
          payment_row.amount * 100
       OR p_amount_subunit::numeric <>
          refund_row.amount * 100
       OR p_currency IS DISTINCT FROM payment_row.currency
       OR p_currency IS DISTINCT FROM refund_row.currency THEN
        RAISE EXCEPTION 'Refund amount or currency mismatch';
    END IF;

    IF provider_refund_id_value IS NOT NULL
       AND refund_row.provider_refund_id IS NOT NULL
       AND refund_row.provider_refund_id IS DISTINCT FROM
           provider_refund_id_value THEN
        RAISE EXCEPTION 'Provider refund ID mismatch';
    END IF;

    -- Idempotent replay: never restore stock twice.
    IF refund_row.status = 'processed' THEN
        IF payment_row.status <> 'refunded'
           OR order_row.status <> 'cancelled'
           OR refund_row.processed_at IS NULL THEN
            RAISE EXCEPTION 'Processed refund has inconsistent records';
        END IF;

        RETURN refund_row;
    END IF;

    IF refund_row.status IN ('failed', 'rejected') THEN
        RAISE EXCEPTION
            'Failed or rejected refund requires reconciliation';
    END IF;

    IF refund_row.status NOT IN (
        'initiating',
        'pending',
        'processing',
        'needs_attention',
        'outcome_unknown'
    ) THEN
        RAISE EXCEPTION 'Refund is not eligible for completion';
    END IF;

    IF payment_row.status <> 'paid' THEN
        RAISE EXCEPTION 'Only paid payments can be refunded';
    END IF;

    IF order_row.status NOT IN ('confirmed', 'processing', 'ready') THEN
        RAISE EXCEPTION 'Order is not eligible for refund cancellation';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.order_items AS oi
        WHERE oi.order_id = order_row.id
    ) THEN
        RAISE EXCEPTION 'Order has no items to restore';
    END IF;

    -- Restore each product's reserved stock in a deterministic order.
    FOR item_row IN
        SELECT
            oi.product_id,
            SUM(oi.quantity)::integer AS quantity
        FROM public.order_items AS oi
        WHERE oi.order_id = order_row.id
        GROUP BY oi.product_id
        ORDER BY oi.product_id
    LOOP
        UPDATE public.products AS pr
        SET
            stock_quantity = pr.stock_quantity + item_row.quantity,
            updated_at = pg_catalog.now()
        WHERE pr.id = item_row.product_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Cannot restore stock for product %',
                item_row.product_id;
        END IF;
    END LOOP;

    UPDATE public.payment_refunds AS pr
    SET
        status = 'processed',
        provider_status = 'processed',
        provider_refund_id = COALESCE(
            provider_refund_id_value,
            pr.provider_refund_id
        ),
        failure_code = NULL,
        processed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE pr.id = refund_row.id
    RETURNING pr.* INTO refund_row;

    UPDATE public.payments AS p
    SET
        status = 'refunded',
        updated_at = pg_catalog.now()
    WHERE p.id = payment_row.id
      AND p.status = 'paid';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment status changed during refund completion';
    END IF;

    UPDATE public.orders AS o
    SET
        status = 'cancelled',
        updated_at = pg_catalog.now()
    WHERE o.id = order_row.id
      AND o.status IN ('confirmed', 'processing', 'ready');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order status changed during refund completion';
    END IF;

    RETURN refund_row;
END;
$function$;


REVOKE ALL PRIVILEGES
ON FUNCTION public.update_payment_refund_status(
    text, text, bigint, text, text, text, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.update_payment_refund_status(
    text, text, bigint, text, text, text, text
)
TO service_role;


REVOKE ALL PRIVILEGES
ON FUNCTION public.complete_payment_refund(
    text, text, bigint, text
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.complete_payment_refund(
    text, text, bigint, text
)
TO service_role;

COMMIT;
