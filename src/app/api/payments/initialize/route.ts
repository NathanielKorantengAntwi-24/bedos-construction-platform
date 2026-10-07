import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { initializePayment } from "@/features/payments/payment.service";
import { parseJson } from "@/server/http/parse-json";
import { errorResponse } from "@/server/http/api-error";

type InitializePaymentRequest = {
  order_id: string;
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
        { error: "Only active customers can initialize payments" },
        { status: 403 },
      );
    }

    const body = await parseJson<InitializePaymentRequest>(request);

    if (!body.order_id) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 },
      );
    }

    const customerEmail = context.user.email;

    if (!customerEmail) {
      return NextResponse.json(
        { error: "Customer email is required for payment" },
        { status: 400 },
      );
    }

    const result = await initializePayment(
      body.order_id,
      context.user.id,
      customerEmail,
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}