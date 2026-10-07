import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { getCustomerPayment } from "@/features/payments/payment.service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  try {
    const userContext = await getUserContext();

    if (!userContext) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    if (
      userContext.profile.account_status !== "active" ||
      userContext.role?.name !== "customer"
    ) {
      return NextResponse.json(
        { error: "Only active customers can view their payments" },
        { status: 403 },
      );
    }

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Payment ID is required" },
        { status: 400 },
      );
    }

    const payment = await getCustomerPayment(
      id,
      userContext.user.id,
    );

    return NextResponse.json({ payment });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error",
      },
      { status: 404 },
    );
  }
}