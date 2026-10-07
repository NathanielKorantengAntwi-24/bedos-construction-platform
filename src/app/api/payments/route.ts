import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import {
  listCustomerPayments,
} from "@/features/payments/payment.service";

export async function GET() {
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
        { error: "Only active customers can view their payments" },
        { status: 403 },
      );
    }

    const payments = await listCustomerPayments(context.user.id);

    return NextResponse.json({ payments });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error",
      },
      { status: 500 },
    );
  }
}