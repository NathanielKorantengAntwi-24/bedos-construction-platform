import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { createOrder, listCustomerOrders } from "@/features/orders/order.service";
import { validateCreateOrderInput } from "@/features/orders/validate-create-order";
import { parseJson } from "@/server/http/parse-json";
import { errorResponse } from "@/server/http/api-error";


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
        { error: "Only active customers can create orders" },
        { status: 403 },
      );
    }

    const rawBody = await parseJson<unknown>(request);
    const body = validateCreateOrderInput(rawBody);

    const order = await createOrder(context.user.id, body);

    return NextResponse.json(
      { order },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

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
        { error: "Only active customers can view their orders" },
        { status: 403 },
      );
    }

    const orders = await listCustomerOrders(context.user.id);

    return NextResponse.json({ orders });
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