
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import type { Payment } from "./payment.types";
import {
  paystackRequest,
  PaystackRequestError,
} from "@/lib/paystack/client";
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
  const reference = `BEDOS-${orderId}-${crypto.randomUUID()}`;

  const { data: reservationData, error: reservationError } =
    await supabase.rpc("reserve_payment_attempt", {
      p_order_id: orderId,
      p_customer_id: customerId,
      p_provider_reference: reference,
    });

  if (reservationError) {
    const message = reservationError.message ?? "";

    if (message.includes("Order not found")) {
      throw new ApiError("Order not found", 404);
    }

    if (message.includes("Only pending orders can be paid")) {
      throw new ApiError("Only pending orders can be paid", 400);
    }

    if (message.includes("already been paid")) {
      throw new ApiError("This order has already been paid", 409);
    }

    if (message.includes("already in progress")) {
      throw new ApiError(
        "A payment is already in progress for this order",
        409,
      );
    }

    if (
      message.includes("Order amount must be positive") ||
      message.includes("Order currency is required")
    ) {
      throw new ApiError(
        "The order amount or currency is invalid for payment",
        400,
      );
    }

    console.error("Payment reservation RPC failed:", {
      code: reservationError.code,
    });

    throw new ApiError("Failed to reserve payment attempt", 500);
  }

  const reservedPayment = (Array.isArray(reservationData)
    ? reservationData[0]
    : reservationData) as Payment | null;

  if (!reservedPayment) {
    throw new ApiError("Failed to reserve payment attempt", 500);
  }

  const amount = Number(reservedPayment.amount);
  const currency = reservedPayment.currency;
  const amountInSubunit = Math.round(amount * 100);

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(amountInSubunit) ||
    amountInSubunit <= 0 ||
    Math.abs(amount * 100 - amountInSubunit) > 1e-7 ||
    typeof currency !== "string" ||
    currency.trim() === ""
  ) {
    console.error("Reserved payment contains invalid amount or currency:", {
      paymentId: reservedPayment.id,
    });

    throw new ApiError("The order amount or currency is invalid for payment", 400);
  }
  let paystackResponse: PaystackInitializeResponse;

  try {
    paystackResponse =
      await paystackRequest<PaystackInitializeResponse>(
        "/transaction/initialize",
        {
          method: "POST",
          body: JSON.stringify({
            email: customerEmail,
            amount: amountInSubunit,
            currency,
            reference,
            metadata: {
              order_id: reservedPayment.order_id,
              customer_id: reservedPayment.customer_id,
            },
          }),
        },
      );
  } catch (error) {
    if (
      error instanceof PaystackRequestError &&
      !error.outcomeUnknown
    ) {
      const { error: updateError } = await supabase
        .from("payments")
        .update({ status: "failed" })
        .eq("id", reservedPayment.id)
        .eq("status", "processing");

      if (updateError) {
        console.error(
          "Failed to update rejected payment attempt:",
          updateError,
        );
      }

      if (error.code === "configuration") {
        console.error("Paystack configuration error:", error);

        throw new ApiError(
          "Payment service is temporarily unavailable",
          500,
        );
      }

      console.error("Paystack rejected payment initialization:", {
        paymentId: reservedPayment.id,
        code: error.code,
      });

      throw new ApiError(
        "Paystack could not initialize this payment. Please try again.",
        502,
      );
    }

    console.error(
      "Paystack initialization outcome is uncertain; payment attempt retained for reconciliation.",
      error,
    );

    throw new ApiError(
      "Payment initialization could not be confirmed. Please contact support before trying again.",
      503,
    );
  }

  if (
    paystackResponse.reference !== reference ||
    typeof paystackResponse.authorization_url !== "string" ||
    paystackResponse.authorization_url.trim() === "" ||
    typeof paystackResponse.access_code !== "string" ||
    paystackResponse.access_code.trim() === ""
  ) {
    console.error(
      "Paystack initialization returned an invalid response",
      { paymentId: reservedPayment.id },
    );

    throw new ApiError(
      "Payment initialization could not be confirmed. Please contact support before trying again.",
      503,
    );
  }

  const { data: payment, error: paymentUpdateError } = await supabase
    .from("payments")
    .update({ status: "pending" })
    .eq("id", reservedPayment.id)
    .eq("status", "processing")
    .select(PAYMENT_SELECT)
    .single();

  if (paymentUpdateError || !payment) {
    throw new ApiError(
      "Paystack initialization may have succeeded, but the payment record needs reconciliation.",
      500,
    );
  }

  return {
    payment: payment as Payment,
    authorization_url: paystackResponse.authorization_url,
    access_code: paystackResponse.access_code,
    reference,
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
  .maybeSingle();

if (paymentError) {
  console.error(
    "Failed to load payment for verification:",
    paymentError,
  );

  throw new ApiError("Failed to load payment", 500);
}

if (!payment) {
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

  const paymentAmount = Number(payment.amount);
  const amountInSubunit = Math.round(paymentAmount * 100);

  if (
    !Number.isFinite(paymentAmount) ||
    paymentAmount <= 0 ||
    !Number.isSafeInteger(amountInSubunit) ||
    amountInSubunit <= 0 ||
    Math.abs(paymentAmount * 100 - amountInSubunit) > 1e-7 ||
    paystackResponse.amount !== amountInSubunit
  ) {
    throw new ApiError("Payment amount mismatch", 400);
  }

  if (paystackResponse.currency !== payment.currency) {
    throw new ApiError("Payment currency mismatch", 400);
  }


  const { data: confirmation, error: confirmationError } =
    await supabase.rpc("confirm_payment_and_order", {
      p_payment_id: payment.id,
      p_customer_id: payment.customer_id,
      p_paid_at:
        paystackResponse.paid_at ?? new Date().toISOString(),
    });

  if (confirmationError || !confirmation?.[0]) {
    console.error("Payment confirmation RPC failed:", {
      code: confirmationError?.code,
      hasResult: Boolean(confirmation?.[0]),
    });

    throw new ApiError(
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
  .maybeSingle();

if (paymentError) {
  console.error(
    "Failed to load payment for Paystack webhook:",
    paymentError,
  );

  throw new ApiError("Failed to load payment", 500);
}

if (!payment) {
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

  const paymentAmount = Number(payment.amount);
  const amountInSubunit = Math.round(paymentAmount * 100);

  if (
    !Number.isFinite(paymentAmount) ||
    paymentAmount <= 0 ||
    !Number.isSafeInteger(amountInSubunit) ||
    amountInSubunit <= 0 ||
    Math.abs(paymentAmount * 100 - amountInSubunit) > 1e-7 ||
    paystackResponse.amount !== amountInSubunit
  ) {
    throw new ApiError("Payment amount mismatch", 400);
  }

  if (paystackResponse.currency !== payment.currency) {
    throw new ApiError("Payment currency mismatch", 400);
  }


  const { data: confirmation, error: confirmationError } =
    await supabase.rpc("confirm_payment_and_order", {
      p_payment_id: payment.id,
      p_customer_id: payment.customer_id,
      p_paid_at:
        paystackResponse.paid_at ?? new Date().toISOString(),
    });

  if (confirmationError || !confirmation?.[0]) {
    console.error("Payment confirmation RPC failed:", {
      code: confirmationError?.code,
      hasResult: Boolean(confirmation?.[0]),
    });

    throw new ApiError(
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
