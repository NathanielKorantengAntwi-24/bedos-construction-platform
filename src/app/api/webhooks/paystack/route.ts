import crypto from "crypto";
import { NextResponse } from "next/server";
import { ApiError } from "@/server/http/api-error";
import { processPaystackWebhookPayment } from "@/features/payments/payment.service";


function verifyPaystackSignature(
  rawBody: string,
  signature: string,
): boolean {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Paystack secret key is not configured");
  }

  // A SHA-512 HMAC digest is represented by 128 hexadecimal characters.
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
    amount?: number;
    currency?: string;
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
        Number.isFinite(data.amount))) &&
    (data.currency === undefined ||
      typeof data.currency === "string")
  );
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

    const isValid = verifyPaystackSignature(
      rawBody,
      signature,
    );

    if (!isValid) {
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

        return NextResponse.json({ error: "Payment not found; retry later" }, { status: 500 });
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
