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