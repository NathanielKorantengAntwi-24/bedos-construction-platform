import crypto from "crypto";
import { NextResponse } from "next/server";
import { processPaystackWebhookPayment } from "@/features/payments/payment.service";

function verifyPaystackSignature(
  rawBody: string,
  signature: string,
): boolean {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Paystack secret key is not configured");
  }

  const expectedSignature = crypto
    .createHmac("sha512", secretKey)
    .update(rawBody)
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const receivedBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedBuffer,
    receivedBuffer,
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

    let payload: PaystackWebhookPayload;

    try {
      payload = JSON.parse(rawBody) as PaystackWebhookPayload;
    } catch {
      return NextResponse.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
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
        error instanceof Error &&
        error.message === "Payment not found"
      ) {
        console.warn(
          "Ignoring Paystack webhook for unknown payment reference:",
          reference,
        );

        return NextResponse.json({ received: true });
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