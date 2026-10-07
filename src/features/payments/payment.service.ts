import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import type { Payment } from "./payment.types";
import { paystackRequest } from "@/lib/paystack/client";
import type {
  PaystackInitializeResponse,
  PaystackVerifyResponse,
} from "@/lib/paystack/paystack.types";
import { createNotification } from "@/features/notifications/notification.service";



const PAYMENT_SELECT = `
  id,
  order_id,
  customer_id,
  provider,
  provider_reference,
  amount,
  currency,
  status,
  paid_at,
  created_at,
  updated_at
`;

export async function getCustomerPayment(
  paymentId: string,
  customerId: string,
): Promise<Payment> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payments")
    .select(PAYMENT_SELECT)
    .eq("id", paymentId)
    .eq("customer_id", customerId)
    .single();

  if (error || !data) {
    throw new ApiError("Payment not found", 404);
  }

  return data as Payment;
}

export async function listCustomerPayments(
  customerId: string,
): Promise<Payment[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payments")
    .select(PAYMENT_SELECT)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError("Failed to load payments", 500);
  }

  return (data ?? []) as Payment[];
}

export async function listManagedPayments(): Promise<Payment[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payments")
    .select(PAYMENT_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError("Failed to load payments", 500);
  }

  return (data ?? []) as Payment[];
}

export async function getManagedPayment(
  paymentId: string,
): Promise<Payment> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payments")
    .select(PAYMENT_SELECT)
    .eq("id", paymentId)
    .single();

  if (error || !data) {
    throw new ApiError("Payment not found", 404);
  }

  return data as Payment;
}

export async function initializePayment(
  orderId: string,
  customerId: string,
  customerEmail: string,
): Promise<{
  payment: Payment;
  authorization_url: string;
  access_code: string;
  reference: string;
}> {
  const supabase = createAdminClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(`
      id,
      customer_id,
      total_amount,
      currency,
      status
    `)
    .eq("id", orderId)
    .eq("customer_id", customerId)
    .single();

  if (orderError || !order) {
    throw new ApiError("Order not found", 404);
  }

  if (order.status !== "pending") {
    throw new ApiError(
      "Only pending orders can be paid",
      400,
    );
  }

  if (Number(order.total_amount) <= 0) {
  throw new ApiError(
    "Order amount must be greater than zero",
    400,
  );
}
  const {
    data: existingPayments,
    error: existingPaymentError,
  } = await supabase
    .from("payments")
    .select("id, status")
    .eq("order_id", orderId)
    .in("status", ["pending", "processing", "paid"]);

  if (existingPaymentError) {
    throw new ApiError(existingPaymentError.message, 500);
  }

  const paidPayment = existingPayments?.find(
    (payment) => payment.status === "paid",
  );

  if (paidPayment) {
    throw new ApiError(
      "This order has already been paid",
      409,
    );
  }

  if (existingPayments && existingPayments.length > 0) {
    throw new ApiError(
      "A payment is already in progress for this order",
      409,
    );
  }

  const reference = `BEDOS-${order.id}-${Date.now()}`;

  const amountInSubunit = Math.round(
    Number(order.total_amount) * 100,
  );

  const paystackResponse =
    await paystackRequest<PaystackInitializeResponse>(
      "/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email: customerEmail,
          amount: amountInSubunit,
          currency: order.currency,
          reference,
          metadata: {
            order_id: order.id,
            customer_id: order.customer_id,
          },
        }),
      },
    );

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .insert({
      order_id: order.id,
      customer_id: order.customer_id,
      provider: "paystack",
      provider_reference: paystackResponse.reference,
      amount: order.total_amount,
      currency: order.currency,
      status: "pending",
    })
    .select(PAYMENT_SELECT)
    .single();

  if (paymentError || !payment) {
    throw new ApiError(
      paymentError?.message ?? "Failed to create payment record",
      500,
    );
  }

  return {
    payment: payment as Payment,
    authorization_url: paystackResponse.authorization_url,
    access_code: paystackResponse.access_code,
    reference: paystackResponse.reference,
  };
}

export async function verifyPayment(
  reference: string,
  customerId: string,
): Promise<Payment> {
  const supabase = createAdminClient();

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select(PAYMENT_SELECT)
    .eq("provider", "paystack")
    .eq("provider_reference", reference)
    .eq("customer_id", customerId)
    .single();

  if (paymentError || !payment) {
    throw new ApiError("Payment not found", 404);
  }

  const paystackResponse =
    await paystackRequest<PaystackVerifyResponse>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
      },
    );

  if (paystackResponse.reference !== reference) {
    throw new ApiError("Payment reference mismatch", 400);
  }

  if (paystackResponse.status !== "success") {
    throw new ApiError(
      `Payment has not been completed: ${paystackResponse.status}`,
      400,
    );
  }

  const expectedAmount = Math.round(
    Number(payment.amount) * 100,
  );

  if (paystackResponse.amount !== expectedAmount) {
    throw new ApiError("Payment amount mismatch", 400);
  }

  if (paystackResponse.currency !== payment.currency) {
    throw new ApiError("Payment currency mismatch", 400);
  }

    if (payment.status === "paid") {
  return payment as Payment;
}

  const { data: confirmation, error: confirmationError } =
    await supabase.rpc("confirm_payment_and_order", {
      p_payment_id: payment.id,
      p_customer_id: payment.customer_id,
      p_paid_at:
        paystackResponse.paid_at ??
        new Date().toISOString(),
    });

  if (confirmationError || !confirmation?.[0]) {
    throw new ApiError(
      confirmationError?.message ??
        "Failed to confirm payment and order",
      500,
    );
  }

  const confirmedPayment = confirmation[0];

  try {
    await createNotification({
      recipient_id: payment.customer_id,
      notification_type: "order_confirmed",
      title: "Order confirmed",
      message: `Your order ${confirmedPayment.order_number} has been confirmed.`,
      channel: "in_app",
      related_entity_type: "order",
      related_entity_id: confirmedPayment.order_id,
    });
  } catch (notificationError) {
    console.error(
      "Failed to create order confirmation notification:",
      notificationError,
    );
  }

  return {
    ...payment,
    status: confirmedPayment.payment_status,
    paid_at: confirmedPayment.paid_at,
  } as Payment;
}

export async function processPaystackWebhookPayment(
  reference: string,
): Promise<Payment> {
  const supabase = createAdminClient();

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select(PAYMENT_SELECT)
    .eq("provider", "paystack")
    .eq("provider_reference", reference)
    .single();

  if (paymentError || !payment) {
    throw new ApiError("Payment not found", 404);
  }

  const paystackResponse =
    await paystackRequest<PaystackVerifyResponse>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: "GET",
      },
    );

  if (paystackResponse.reference !== reference) {
    throw new ApiError("Payment reference mismatch", 400);
  }

  if (paystackResponse.status !== "success") {
    throw new ApiError(
      `Payment has not been completed: ${paystackResponse.status}`,
      400,
    );
  }

  const expectedAmount = Math.round(
    Number(payment.amount) * 100,
  );

  if (paystackResponse.amount !== expectedAmount) {
    throw new ApiError("Payment amount mismatch", 400);
  }

  if (paystackResponse.currency !== payment.currency) {
    throw new ApiError("Payment currency mismatch", 400);
  }

  if (payment.status === "paid") {
    return payment as Payment;
  }

  const { data: confirmation, error: confirmationError } =
    await supabase.rpc("confirm_payment_and_order", {
      p_payment_id: payment.id,
      p_customer_id: payment.customer_id,
      p_paid_at:
        paystackResponse.paid_at ??
        new Date().toISOString(),
    });

  if (confirmationError || !confirmation?.[0]) {
    throw new ApiError(
      confirmationError?.message ??
        "Failed to confirm payment and order",
      500,
    );
  }

  const confirmedPayment = confirmation[0];

   try {
    await createNotification({
      recipient_id: payment.customer_id,
      notification_type: "order_confirmed",
      title: "Order confirmed",
      message: `Your order ${confirmedPayment.order_number} has been confirmed.`,
      channel: "in_app",
      related_entity_type: "order",
      related_entity_id: confirmedPayment.order_id,
    });
  } catch (notificationError) {
    console.error(
      "Failed to create order confirmation notification:",
      notificationError,
    );
  }

  return {
    ...payment,
    status: confirmedPayment.payment_status,
    paid_at: confirmedPayment.paid_at,
  } as Payment;
}