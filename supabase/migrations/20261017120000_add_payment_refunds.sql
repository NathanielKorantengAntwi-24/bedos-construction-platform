-- Track full refund requests separately from original payments.
-- Refund lifecycle operations will use protected server-side functions.

BEGIN;

CREATE TABLE public.payment_refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    payment_id uuid NOT NULL
        REFERENCES public.payments(id) ON DELETE RESTRICT,

    order_id uuid NOT NULL
        REFERENCES public.orders(id) ON DELETE RESTRICT,

    provider text NOT NULL DEFAULT 'paystack'
        CHECK (provider = 'paystack'),

    provider_transaction_reference text NOT NULL,

    provider_refund_id text,

    amount numeric NOT NULL
        CHECK (amount > 0),

    currency text NOT NULL
        CHECK (length(btrim(currency)) > 0),

    status text NOT NULL DEFAULT 'initiating'
        CHECK (
            status IN (
                'initiating',
                'pending',
                'processing',
                'needs_attention',
                'processed',
                'failed',
                'rejected',
                'outcome_unknown'
            )
        ),

    provider_status text
        CHECK (
            provider_status IS NULL
            OR provider_status IN (
                'pending',
                'processing',
                'needs-attention',
                'processed',
                'failed'
            )
        ),

    reason text NOT NULL
        CHECK (
            length(btrim(reason)) BETWEEN 3 AND 1000
        ),

    initiated_by uuid NOT NULL
        REFERENCES public.profiles(id) ON DELETE RESTRICT,

    failure_code text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,

    CONSTRAINT payment_refunds_one_full_refund_per_payment
        UNIQUE (payment_id),

    CONSTRAINT payment_refunds_provider_refund_id_key
        UNIQUE (provider_refund_id),

    CONSTRAINT payment_refunds_processed_at_check
        CHECK (
            (status = 'processed' AND processed_at IS NOT NULL)
            OR
            (status <> 'processed' AND processed_at IS NULL)
        )
);

CREATE INDEX payment_refunds_order_id_idx
    ON public.payment_refunds(order_id);

CREATE INDEX payment_refunds_status_created_at_idx
    ON public.payment_refunds(status, created_at DESC);

ALTER TABLE public.payment_refunds
    ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
    ON TABLE public.payment_refunds
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE
    ON TABLE public.payment_refunds
    TO service_role;

COMMIT;
