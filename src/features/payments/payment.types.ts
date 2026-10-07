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