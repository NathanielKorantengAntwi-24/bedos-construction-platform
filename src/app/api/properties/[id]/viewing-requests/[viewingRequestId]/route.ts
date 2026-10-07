import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { requirePermission } from "@/server/auth/require-permission";
import { requireRole } from "@/server/auth/require-role";
import { ApiError, errorResponse } from "@/server/http/api-error";
import { parseJson } from "@/server/http/parse-json";
import {
  deleteViewingRequest,
  getViewingRequest,
  updateViewingRequest,
} from "@/features/properties/viewing-request.service";
import type {
  UpdateViewingRequestInput,
  ViewingRequestStatus,
} from "@/features/properties/viewing-request.types";

type RouteContext = {
  params: Promise<{
    id: string;
    viewingRequestId: string;
  }>;
};

const VALID_STATUSES: ViewingRequestStatus[] = [
  "new",
  "contacted",
  "in_progress",
  "completed",
  "cancelled",
];

function validateUpdateInput(input: UpdateViewingRequestInput) {
  if (
    input.preferred_date !== undefined &&
    input.preferred_date !== null &&
    !/^\d{4}-\d{2}-\d{2}$/.test(input.preferred_date)
  ) {
    throw new ApiError(
      "preferred_date must use YYYY-MM-DD format",
      400,
    );
  }

  if (
    input.preferred_time !== undefined &&
    input.preferred_time !== null &&
    !/^\d{2}:\d{2}(:\d{2})?$/.test(input.preferred_time)
  ) {
    throw new ApiError(
      "preferred_time must use HH:MM or HH:MM:SS format",
      400,
    );
  }

  if (
    input.message !== undefined &&
    input.message !== null &&
    input.message.length > 2000
  ) {
    throw new ApiError(
      "message must not exceed 2000 characters",
      400,
    );
  }

  if (
    input.status !== undefined &&
    !VALID_STATUSES.includes(input.status)
  ) {
    throw new ApiError("Invalid viewing request status", 400);
  }

  if (
    input.assigned_to !== undefined &&
    input.assigned_to !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.assigned_to,
    )
  ) {
    throw new ApiError(
      "assigned_to must be a valid user ID",
      400,
    );
  }
}

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  try {
    const {
      id: propertyId,
      viewingRequestId,
    } = await context.params;

    const userContext = await getUserContext();

    if (!userContext) {
      throw new ApiError("Unauthorized", 401);
    }

    if (userContext.profile.account_status !== "active") {
      throw new ApiError("Account is not active", 403);
    }

    const viewingRequest = await getViewingRequest(
      propertyId,
      viewingRequestId,
    );

    const isStaff =
      userContext.role?.name === "administrator" ||
      userContext.role?.name === "sales_customer_service";

    if (!isStaff && viewingRequest.customer_id !== userContext.user.id) {
      throw new ApiError("Forbidden", 403);
    }

    return NextResponse.json({ data: viewingRequest });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const {
      id: propertyId,
      viewingRequestId,
    } = await context.params;

    const userContext = await getUserContext();

    if (!userContext) {
      throw new ApiError("Unauthorized", 401);
    }

    if (userContext.profile.account_status !== "active") {
      throw new ApiError("Account is not active", 403);
    }

    const isStaff =
      userContext.role?.name === "administrator" ||
      userContext.role?.name === "sales_customer_service";

    const viewingRequest = await getViewingRequest(
      propertyId,
      viewingRequestId,
    );

    if (!isStaff) {
      if (
        userContext.role?.name !== "customer" ||
        viewingRequest.customer_id !== userContext.user.id
      ) {
        throw new ApiError("Forbidden", 403);
      }

      if (viewingRequest.status !== "new") {
        throw new ApiError(
          "Viewing requests can only be edited before staff processing begins",
          403,
        );
      }
    } else {
      await requirePermission("viewings.manage");
    }

    const body = await parseJson<UpdateViewingRequestInput>(request);

    validateUpdateInput(body);

    if (!isStaff) {
      const hasStaffOnlyFields =
        body.status !== undefined ||
        body.assigned_to !== undefined;

      if (hasStaffOnlyFields) {
        throw new ApiError(
          "Customers can only edit the preferred date, preferred time, and message",
          403,
        );
      }
    }

  const updatedViewingRequest = await updateViewingRequest(
  propertyId,
  viewingRequestId,
  body,
  {
    userId: userContext.user.id,
    isStaff,
  },
);

    return NextResponse.json({ data: updatedViewingRequest });
   } catch (error) {
    return errorResponse(error);
  }
}


export async function DELETE(
  _request: Request,
  context: RouteContext,
) {
  try {
    const {
      id: propertyId,
      viewingRequestId,
    } = await context.params;

    await requireRole(["administrator"]);

    await deleteViewingRequest(
      propertyId,
      viewingRequestId,
    );

    return NextResponse.json({
      message: "Viewing request deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}