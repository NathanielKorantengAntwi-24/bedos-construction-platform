export type PaystackInitializeResponse = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackVerifyResponse = {
  id: number;
  domain: string;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  transaction_date: string;
  paid_at: string | null;
  channel: string;
  gateway_response: string;
  customer: {
    id: number;
    email: string;
    customer_code: string;
  };
};
export type PaystackRefundStatus =
  | "pending"
  | "processing"
  | "needs-attention"
  | "processed"
  | "failed";

export type PaystackCreateRefundResponse = {
  id: number;
  status: PaystackRefundStatus;
  transaction: {
    id: number;
    reference: string;
    amount: number;
    currency: string;
  };
  amount: number;
  currency: string;
  refunded_at?: string | null;
  expected_at?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Raw refund record retrieved from Paystack.
 *
 * Provider responses must be validated at runtime before
 * they can be used to update Bedos financial records.
 */
export type PaystackRefundLookupRecord = {
  id: unknown;
  transaction: unknown;
  amount: unknown;
  currency: unknown;
  status: unknown;
  merchant_note?: unknown;
};

/**
 * The Paystack List Refunds endpoint returns an array.
 */
export type PaystackRefundListResponse =
  PaystackRefundLookupRecord[];
