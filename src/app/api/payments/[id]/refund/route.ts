import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/require-permission";
import { initiatePaymentRefund } from "@/features/payments/payment.service";
import { parseJson } from "@/server/http/parse-json";
import { ApiError, errorResponse } from "@/server/http/api-error";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: RouteContext,
) {
  try {
    const userContext = await requirePermission("payments.manage");

    if (
      !["administrator", "finance"].includes(
        userContext.role?.name ?? "",
      )
    ) {
      throw new ApiError("Forbidden", 403);
    }

    const { id } = await context.params;

    if (!UUID_PATTERN.test(id)) {
      throw new ApiError("A valid payment ID is required", 400);
    }

    const rawBody = await parseJson<unknown>(request);

    if (
      typeof rawBody !== "object" ||
      rawBody === null ||
      Array.isArray(rawBody)
    ) {
      throw new ApiError("Request body must be an object", 400);
    }

    const body = rawBody as Record<string, unknown>;

    if (Object.keys(body).some((key) => key !== "reason")) {
      throw new ApiError("Request contains unsupported fields", 400);
    }

    if (typeof body.reason !== "string") {
      throw new ApiError("Refund reason is required", 400);
    }

    const reason = body.reason.trim();

    if (reason.length < 3 || reason.length > 1000) {
      throw new ApiError(
        "Refund reason must contain 3 to 1000 characters",
        400,
      );
    }

    const refund = await initiatePaymentRefund(
      id,
      userContext.user.id,
      reason,
    );

    return NextResponse.json(
      { refund },
      { status: refund.status === "processed" ? 200 : 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}