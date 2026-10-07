import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/require-permission";
import { updateOrderStatus } from "@/features/orders/order.service";
import { parseJson } from "@/server/http/parse-json";
import { errorResponse } from "@/server/http/api-error";
import type { OrderStatus } from "@/features/orders/order.types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type UpdateStatusRequest = {
  status: OrderStatus;
};

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const userContext = await requirePermission("orders.manage");

    if (
      !["administrator", "finance"].includes(
        userContext.role?.name ?? "",
      )
    ) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 },
      );
    }

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 },
      );
    }

    const body = await parseJson<UpdateStatusRequest>(request);

    if (!body.status) {
      return NextResponse.json(
        { error: "Status is required" },
        { status: 400 },
      );
    }

    const order = await updateOrderStatus(id, body.status);

    return NextResponse.json({ order });
  } catch (error) {
    return errorResponse(error);
  }
}