import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { verifyPayment } from "@/features/payments/payment.service";
import { parseJson } from "@/server/http/parse-json";
import { errorResponse } from "@/server/http/api-error";

type VerifyPaymentRequest = {
  reference: string;
};

export async function POST(request: Request) {
  try {
    const context = await getUserContext();

    if (!context) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    if (
      context.profile.account_status !== "active" ||
      context.role?.name !== "customer"
    ) {
      return NextResponse.json(
        { error: "Only active customers can verify payments" },
        { status: 403 },
      );
    }

    const body = await parseJson<VerifyPaymentRequest>(request);

    if (!body.reference) {
      return NextResponse.json(
        { error: "Payment reference is required" },
        { status: 400 },
      );
    }

    const payment = await verifyPayment(
      body.reference,
      context.user.id,
    );

    return NextResponse.json({
      payment,
      message: "Payment verified successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}