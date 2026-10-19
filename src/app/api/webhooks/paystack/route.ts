import crypto from "crypto";
import { NextResponse } from "next/server";
import { ApiError } from "@/server/http/api-error";
import {
  processPaystackRefundWebhook,
  processPaystackWebhookPayment,
} from "@/features/payments/payment.service";
import type { PaystackRefundWebhookEvent } from "@/features/payments/payment.service";
import type { PaystackRefundStatus } from "@/lib/paystack/paystack.types";

function verifyPaystackSignature(
  rawBody: string,
  signature: string,
): boolean {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Paystack secret key is not configured");
  }

  if (!/^[a-fA-F0-9]{128}$/.test(signature)) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha512", secretKey)
    .update(rawBody)
    .digest();

  const receivedSignature = Buffer.from(signature, "hex");

  if (expectedSignature.length !== receivedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedSignature,
    receivedSignature,
  );
}

type PaystackWebhookPayload = {
  event: string;
  data?: {
    reference?: string;
    status?: string;
    amount?: number | string;
    currency?: string;
    transaction_reference?: string;
    refund_reference?: string | null;
  };
};

function isPaystackWebhookPayload(
  value: unknown,
): value is PaystackWebhookPayload {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const payload = value as Record<string, unknown>;

  if (typeof payload.event !== "string") {
    return false;
  }

  if (payload.data === undefined) {
    return true;
  }

  if (
    typeof payload.data !== "object" ||
    payload.data === null ||
    Array.isArray(payload.data)
  ) {
    return false;
  }

  const data = payload.data as Record<string, unknown>;

  return (
    (data.reference === undefined ||
      typeof data.reference === "string") &&
    (data.status === undefined ||
      typeof data.status === "string") &&
    (data.amount === undefined ||
      (typeof data.amount === "number" &&
        Number.isFinite(data.amount)) ||
      typeof data.amount === "string") &&
    (data.currency === undefined ||
      typeof data.currency === "string") &&
    (data.transaction_reference === undefined ||
      typeof data.transaction_reference === "string") &&
    (data.refund_reference === undefined ||
      data.refund_reference === null ||
      typeof data.refund_reference === "string")
  );
}

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

function parseSubunitAmount(
  value: number | string | undefined,
): number | null {
  let amount: number;

  if (typeof value === "number") {
    amount = value;
  } else if (
    typeof value === "string" &&
    /^[0-9]+$/.test(value)
  ) {
    amount = Number(value);
  } else {
    return null;
  }

  return Number.isSafeInteger(amount) && amount > 0
    ? amount
    : null;
}

export async function POST(request: Request) {
  try {
    const signature = request.headers.get("x-paystack-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing Paystack signature" },
        { status: 401 },
      );
    }

    const rawBody = await request.text();

    if (!verifyPaystackSignature(rawBody, signature)) {
      return NextResponse.json(
        { error: "Invalid Paystack signature" },
        { status: 401 },
      );
    }

    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    if (!isPaystackWebhookPayload(parsedPayload)) {
      return NextResponse.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    const payload = parsedPayload;

    if (payload.event.startsWith("refund.")) {
      if (
        !Object.prototype.hasOwnProperty.call(
          REFUND_EVENT_STATUS,
          payload.event,
        )
      ) {
        return NextResponse.json(
          { error: "Unsupported refund event" },
          { status: 400 },
        );
      }

      const event =
        payload.event as PaystackRefundWebhookEvent;
      const data = payload.data;
      const expectedStatus = REFUND_EVENT_STATUS[event];
      const amountSubunit = parseSubunitAmount(data?.amount);
      const transactionReference = data?.transaction_reference;
      const currency = data?.currency;

      if (
        !data ||
        data.status !== expectedStatus ||
        !transactionReference?.trim() ||
        amountSubunit === null ||
        !currency?.trim()
      ) {
        return NextResponse.json(
          { error: "Invalid refund webhook details" },
          { status: 400 },
        );
      }

      await processPaystackRefundWebhook({
        event,
        transactionReference,
        amountSubunit,
        currency,
        providerStatus: expectedStatus,
      });

      return NextResponse.json({ received: true });
    }

    if (payload.event !== "charge.success") {
      return NextResponse.json({ received: true });
    }

    const reference = payload.data?.reference;

    if (!reference) {
      return NextResponse.json(
        { error: "Payment reference is missing" },
        { status: 400 },
      );
    }

    try {
      await processPaystackWebhookPayment(reference);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 404 &&
        error.message === "Payment not found"
      ) {
        console.warn(
          "Ignoring Paystack webhook for unknown payment reference:",
          reference,
        );

        return NextResponse.json(
          { error: "Payment not found; retry later" },
          { status: 500 },
        );
      }

      throw error;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Paystack webhook error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}