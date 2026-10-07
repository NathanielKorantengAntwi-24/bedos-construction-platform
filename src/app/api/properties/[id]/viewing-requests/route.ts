import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { requirePermission } from "@/server/auth/require-permission";
import { ApiError, errorResponse } from "@/server/http/api-error";
import { parseJson } from "@/server/http/parse-json";
import {
  createViewingRequest,
  listPropertyViewingRequests,
} from "@/features/properties/viewing-request.service";
import type { CreateViewingRequestInput } from "@/features/properties/viewing-request.types";

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
    const { id: propertyId } = await context.params;

    await requirePermission("viewings.manage");

    const requests = await listPropertyViewingRequests(propertyId);

    return NextResponse.json({ data: requests });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
) {
  try {
    const { id: propertyId } = await context.params;

    const userContext = await getUserContext();

    if (!userContext) {
      throw new ApiError("Unauthorized", 401);
    }

    if (userContext.profile.account_status !== "active") {
      throw new ApiError("Account is not active", 403);
    }

    if (userContext.role?.name !== "customer") {
      throw new ApiError(
        "Only customers can create viewing requests",
        403,
      );
    }

    const body = await parseJson<
      Omit<CreateViewingRequestInput, "property_id">
    >(request);

    const input: CreateViewingRequestInput = {
      property_id: propertyId,
      preferred_date: body.preferred_date ?? null,
      preferred_time: body.preferred_time ?? null,
      message: body.message ?? null,
    };

    if (
      input.preferred_date !== null &&
      input.preferred_date !== undefined &&
      !/^\d{4}-\d{2}-\d{2}$/.test(input.preferred_date)
    ) {
      throw new ApiError(
        "preferred_date must use YYYY-MM-DD format",
        400,
      );
    }

    if (
      input.preferred_time !== null &&
      input.preferred_time !== undefined &&
      !/^\d{2}:\d{2}(:\d{2})?$/.test(input.preferred_time)
    ) {
      throw new ApiError(
        "preferred_time must use HH:MM or HH:MM:SS format",
        400,
      );
    }

    if (
      input.message !== null &&
      input.message !== undefined &&
      input.message.length > 2000
    ) {
      throw new ApiError(
        "message must not exceed 2000 characters",
        400,
      );
    }

    const viewingRequest = await createViewingRequest(
      input,
      userContext.user.id,
    );

    return NextResponse.json(
      { data: viewingRequest },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}