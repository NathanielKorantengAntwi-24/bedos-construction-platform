export type PaymentProvider = "paystack";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded";

export type Payment = {
  id: string;
  order_id: string;
  customer_id: string;
  provider: PaymentProvider;
  provider_reference: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InitializePaymentInput = {
  order_id: string;
};

export type VerifyPaymentInput = {
  reference: string;
};
export type PaymentRefundStatus =
  | "initiating"
  | "pending"
  | "processing"
  | "needs_attention"
  | "processed"
  | "failed"
  | "rejected"
  | "outcome_unknown";

export type PaymentRefund = {
  id: string;
  payment_id: string;
  order_id: string;
  provider: "paystack";
  provider_transaction_reference: string;
  provider_refund_id: string | null;
  amount: number;
  currency: string;
  status: PaymentRefundStatus;
  provider_status:
    | "pending"
    | "processing"
    | "needs-attention"
    | "processed"
    | "failed"
    | null;
  reason: string;
  initiated_by: string;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};
