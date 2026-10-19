
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import { lookupExistingPaystackRefund } from "@/lib/paystack/refund-lookup";
import type { Payment, PaymentRefund, PaymentRefundStatus } from "./payment.types";
import {
  paystackRequest,
  PaystackRequestError,
} from "@/lib/paystack/client";
import type { PaystackCreateRefundResponse, PaystackInitializeResponse, PaystackRefundStatus, PaystackVerifyResponse } from "@/lib/paystack/paystack.types";

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


  return {
    ...payment,
    status: confirmedPayment.payment_status,
    paid_at: confirmedPayment.paid_at,
  } as Payment;
}


type RefundStatusUpdate =
  Exclude<PaymentRefundStatus, "initiating" | "processed">;

type RefundStatusUpdateInput = {
  status: RefundStatusUpdate;
  amountSubunit: number;
  currency: string;
  providerStatus: PaystackRefundStatus | null;
  providerRefundId: string | null;
  failureCode: string | null;
};

async function persistPaymentRefundStatus(
  admin: ReturnType<typeof createAdminClient>,
  refund: PaymentRefund,
  input: RefundStatusUpdateInput,
): Promise<PaymentRefund> {
  const { data, error } = await admin.rpc(
    "update_payment_refund_status",
    {
      p_provider_transaction_reference:
        refund.provider_transaction_reference,
      p_status: input.status,
      p_amount_subunit: input.amountSubunit,
      p_currency: input.currency,
      p_provider_status: input.providerStatus,
      p_provider_refund_id: input.providerRefundId,
      p_failure_code: input.failureCode,
    },
  );

  const row = Array.isArray(data) ? data[0] : data;

  if (error || !row) {
    console.error("Refund status update failed:", {
      refundId: refund.id,
      code: error?.code,
    });

    throw new ApiError(
      "Refund status could not be recorded; reconciliation is required",
      503,
    );
  }

  return row as PaymentRefund;
}

function mapPaystackRefundStatus(
  status: PaystackRefundStatus,
): RefundStatusUpdate {
  switch (status) {
    case "pending":
      return "pending";
    case "processing":
      return "processing";
    case "needs-attention":
      return "needs_attention";
    case "failed":
      return "failed";
    case "processed":
      throw new ApiError(
        "Processed refunds must use the atomic completion operation",
        500,
      );
  }
}

function isValidPaystackRefundStatus(
  value: unknown,
): value is PaystackRefundStatus {
  return (
    value === "pending" ||
    value === "processing" ||
    value === "needs-attention" ||
    value === "processed" ||
    value === "failed"
  );
}

export async function initiatePaymentRefund(
  paymentId: string,
  initiatedBy: string,
  reason: string,
): Promise<PaymentRefund> {
  const admin = createAdminClient();

  const { data: reservationData, error: reservationError } =
    await admin.rpc("reserve_payment_refund", {
      p_payment_id: paymentId,
      p_initiated_by: initiatedBy,
      p_reason: reason,
    });

  if (reservationError) {
    const message = reservationError.message ?? "";
    const normalizedMessage = message.toLowerCase();

    if (normalizedMessage.includes("refund record already exists")) {
      throw new ApiError(
        "A refund attempt already exists. Reconcile it before retrying.",
        409,
      );
    }

    if (normalizedMessage.includes("permission is required")) {
      throw new ApiError(
        "An active administrator or finance permission is required",
        403,
      );
    }

    if (
      normalizedMessage.includes("payment not found") ||
      normalizedMessage.includes("paystack payment not found")
    ) {
      throw new ApiError("Payment not found", 404);
    }

    if (
      normalizedMessage.includes("only verified paid payments") ||
      normalizedMessage.includes("not eligible") ||
      normalizedMessage.includes("mismatch") ||
      normalizedMessage.includes("cannot be refunded")
    ) {
      throw new ApiError(
        "Payment or order is not eligible for a refund",
        409,
      );
    }

    console.error("Refund reservation failed:", {
      code: reservationError.code,
    });

    throw new ApiError("Unable to reserve the refund", 500);
  }

  const reservedRow = Array.isArray(reservationData)
    ? reservationData[0]
    : reservationData;

  if (!reservedRow) {
    throw new ApiError("Unable to reserve the refund", 500);
  }

  const refund = reservedRow as PaymentRefund;
  const amount = Number(refund.amount);
  const amountSubunit = Math.round(amount * 100);

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(amountSubunit) ||
    amountSubunit <= 0 ||
    Math.abs(amount * 100 - amountSubunit) > 1e-7
  ) {
    console.error("Refund amount is invalid:", {
      refundId: refund.id,
    });

    throw new ApiError(
      "Refund amount is invalid; manual reconciliation is required",
      503,
    );
  }

  let response: PaystackCreateRefundResponse;

  try {
    response = await paystackRequest<PaystackCreateRefundResponse>(
      "/refund",
      {
        method: "POST",
        body: JSON.stringify({
          transaction: refund.provider_transaction_reference,
          merchant_note: `Bedos refund record ${refund.id}`,
        }),
      },
    );
  } catch (error) {
    const isKnownPaystackError =
      error instanceof PaystackRequestError;

    const status: RefundStatusUpdate =
      isKnownPaystackError && !error.outcomeUnknown
        ? "rejected"
        : "outcome_unknown";

    try {
      await persistPaymentRefundStatus(admin, refund, {
        status,
        amountSubunit,
        currency: refund.currency,
        providerStatus: null,
        providerRefundId: null,
        failureCode: isKnownPaystackError
          ? error.code
          : "unknown_error",
      });
    } catch {
      console.error("Refund error state requires reconciliation:", {
        refundId: refund.id,
      });
    }

    if (status === "rejected") {
      throw new ApiError(
        "Paystack did not accept the refund request. The original payment remains paid.",
        502,
      );
    }

    throw new ApiError(
      "The refund outcome is uncertain. Do not retry; reconcile with Paystack first.",
      503,
    );
  }

  const responseMatches =
    Number.isSafeInteger(response.id) &&
    response.id > 0 &&
    isValidPaystackRefundStatus(response.status) &&
    response.transaction?.reference ===
      refund.provider_transaction_reference &&
    response.transaction?.amount === amountSubunit &&
    response.transaction?.currency === refund.currency &&
    response.amount === amountSubunit &&
    response.currency === refund.currency;

  if (!responseMatches) {
    try {
      await persistPaymentRefundStatus(admin, refund, {
        status: "outcome_unknown",
        amountSubunit,
        currency: refund.currency,
        providerStatus: null,
        providerRefundId: null,
        failureCode: "response_mismatch",
      });
    } catch {
      console.error("Mismatched refund response needs reconciliation:", {
        refundId: refund.id,
      });
    }

    throw new ApiError(
      "Paystack returned a response that could not be matched to the refund. Reconciliation is required.",
      503,
    );
  }

  const providerRefundId = String(response.id);

  if (response.status === "processed") {
    const { data, error } = await admin.rpc(
      "complete_payment_refund",
      {
        p_provider_transaction_reference:
          refund.provider_transaction_reference,
        p_provider_refund_id: providerRefundId,
        p_amount_subunit: response.amount,
        p_currency: response.currency,
      },
    );

    const row = Array.isArray(data) ? data[0] : data;

    if (error || !row) {
      console.error("Processed refund needs reconciliation:", {
        refundId: refund.id,
        code: error?.code,
      });

      throw new ApiError(
        "Paystack processed the refund, but Bedos could not complete its database update. Reconciliation is required.",
        503,
      );
    }

    return row as PaymentRefund;
  }

  return persistPaymentRefundStatus(admin, refund, {
    status: mapPaystackRefundStatus(response.status),
    amountSubunit,
    currency: response.currency,
    providerStatus: response.status,
    providerRefundId,
    failureCode: null,
  });
}

export type PaystackRefundWebhookEvent =
  | "refund.pending"
  | "refund.processing"
  | "refund.needs-attention"
  | "refund.failed"
  | "refund.processed";

type PaystackRefundWebhookInput = {
  event: PaystackRefundWebhookEvent;
  transactionReference: string;
  amountSubunit: number;
  currency: string;
  providerStatus: PaystackRefundStatus;
};

const REFUND_EVENT_STATUS: Record<
  PaystackRefundWebhookEvent,
  PaystackRefundStatus
> = {
  "refund.pending": "pending",
  "refund.processing": "processing",
  "refund.needs-attention": "needs-attention",
  "refund.failed": "failed",
  "refund.processed": "processed",
};

export async function processPaystackRefundWebhook(
  input: PaystackRefundWebhookInput,
): Promise<PaymentRefund> {
  if (
    !input.transactionReference.trim() ||
    !Number.isSafeInteger(input.amountSubunit) ||
    input.amountSubunit <= 0 ||
    !input.currency.trim()
  ) {
    throw new ApiError("Invalid refund webhook details", 400);
  }

  if (REFUND_EVENT_STATUS[input.event] !== input.providerStatus) {
    throw new ApiError(
      "Refund event and provider status do not match",
      400,
    );
  }

  const admin = createAdminClient();

  const { data: refundData, error: refundError } = await admin
    .from("payment_refunds")
    .select("*")
    .eq(
      "provider_transaction_reference",
      input.transactionReference,
    )
    .maybeSingle();

  if (refundError) {
    console.error("Failed to load refund webhook record:", {
      code: refundError.code,
    });

    throw new ApiError("Unable to load refund record", 500);
  }

  if (!refundData) {
    throw new ApiError("Refund not found", 404);
  }

  const refund = refundData as PaymentRefund;

  if (input.event === "refund.processed") {
    if (input.currency !== refund.currency) {
      throw new ApiError(
        "Refund currency mismatch; reconciliation required",
        503,
      );
    }

    let verifiedRefund: Awaited<
      ReturnType<typeof lookupExistingPaystackRefund>
    >;

    try {
      verifiedRefund = await lookupExistingPaystackRefund(
        refund.provider_transaction_reference,
        {
          refundId: refund.id,
          amountSubunit: input.amountSubunit,
          currency: refund.currency,
          providerRefundId: refund.provider_refund_id,
        },
      );
    } catch {
      throw new ApiError(
        "Unable to verify Paystack refund identity; reconciliation required",
        503,
      );
    }

    if (
      !verifiedRefund ||
      verifiedRefund.status !== "processed" ||
      !Number.isSafeInteger(verifiedRefund.id) ||
      (verifiedRefund.id as number) <= 0
    ) {
      throw new ApiError(
        "Processed Paystack refund could not be verified; reconciliation required",
        503,
      );
    }

    const { data, error } = await admin.rpc(
      "complete_payment_refund",
      {
        p_provider_transaction_reference:
          input.transactionReference,
        p_provider_refund_id: String(verifiedRefund.id),
        p_amount_subunit: input.amountSubunit,
        p_currency: input.currency,
      },
    );

    const row = Array.isArray(data) ? data[0] : data;

    if (error || !row) {
      console.error("Processed refund webhook needs reconciliation:", {
        refundId: refund.id,
        code: error?.code,
      });

      throw new ApiError(
        "Unable to complete refund atomically; reconciliation is required",
        500,
      );
    }

    return row as PaymentRefund;
  }

  const mappedStatus = mapPaystackRefundStatus(input.providerStatus);

  return persistPaymentRefundStatus(admin, refund, {
    status: mappedStatus,
    amountSubunit: input.amountSubunit,
    currency: input.currency,
    providerStatus: input.providerStatus,
    providerRefundId: null,
    failureCode: null,
  });
}


export async function reconcileExistingPaymentRefund(
  refundId: string,
): Promise<PaymentRefund> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("payment_refunds")
    .select("*")
    .eq("id", refundId)
    .maybeSingle();

  if (error) {
    throw new ApiError("Unable to load refund record", 500);
  }

  if (!data) {
    throw new ApiError("Refund not found", 404);
  }

  const refund = data as PaymentRefund;

  const amount = Number(refund.amount);
  const amountSubunit = Math.round(amount * 100);

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(amountSubunit) ||
    amountSubunit <= 0 ||
    Math.abs(amount * 100 - amountSubunit) > 1e-7
  ) {
    throw new ApiError(
      "Invalid refund amount; manual reconciliation required",
      503,
    );
  }

  if (refund.status === "processed") {
    const { data: completed, error: completionError } =
      await admin.rpc("complete_payment_refund", {
        p_provider_transaction_reference:
          refund.provider_transaction_reference,
        p_provider_refund_id: refund.provider_refund_id,
        p_amount_subunit: amountSubunit,
        p_currency: refund.currency,
      });

    const row = Array.isArray(completed)
      ? completed[0]
      : completed;

    if (completionError || !row) {
      throw new ApiError(
        "Processed refund requires manual reconciliation",
        503,
      );
    }

    return row as PaymentRefund;
  }

  if (
    refund.status === "failed" ||
    refund.status === "rejected"
  ) {
    throw new ApiError(
      "Failed or rejected refund requires manual review",
      409,
    );
  }

  let match: Awaited<
    ReturnType<typeof lookupExistingPaystackRefund>
  >;

  try {
    match = await lookupExistingPaystackRefund(
      refund.provider_transaction_reference,
      {
        refundId: refund.id,
        amountSubunit,
        currency: refund.currency,
        providerRefundId: refund.provider_refund_id,
      },
    );
  } catch {
    throw new ApiError(
      "Paystack refund lookup could not be verified; manual reconciliation required",
      503,
    );
  }

  if (!match) {
    throw new ApiError(
      "No matching Paystack refund found. Do not retry; manual review required.",
      409,
    );
  }

  const providerStatus = match.status;

  if (!isValidPaystackRefundStatus(providerStatus)) {
    throw new ApiError(
      "Invalid Paystack refund status",
      503,
    );
  }

  const providerRefundId = String(match.id);

  if (providerStatus === "processed") {
    const { data: completed, error: completionError } =
      await admin.rpc("complete_payment_refund", {
        p_provider_transaction_reference:
          refund.provider_transaction_reference,
        p_provider_refund_id: providerRefundId,
        p_amount_subunit: amountSubunit,
        p_currency: refund.currency,
      });

    const row = Array.isArray(completed)
      ? completed[0]
      : completed;

    if (completionError || !row) {
      throw new ApiError(
        "Refund completion failed; manual reconciliation required",
        503,
      );
    }

    return row as PaymentRefund;
  }

  return persistPaymentRefundStatus(admin, refund, {
    status: mapPaystackRefundStatus(providerStatus),
    amountSubunit,
    currency: refund.currency,
    providerStatus,
    providerRefundId,
    failureCode: null,
  });
}
