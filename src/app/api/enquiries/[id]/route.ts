import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { requirePermission } from "@/server/auth/require-permission";
import { requireRole } from "@/server/auth/require-role";
import { ApiError, errorResponse } from "@/server/http/api-error";
import { parseJson } from "@/server/http/parse-json";
import {
  deleteEnquiry,
  getEnquiry,
  updateEnquiry,
} from "@/features/enquiries/enquiry.service";
import type {
  EnquiryStatus,
  UpdateEnquiryInput,
} from "@/features/enquiries/enquiry.types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const VALID_STATUSES: EnquiryStatus[] = [
  "new",
  "contacted",
  "in_progress",
  "completed",
];

function validateUpdateInput(input: UpdateEnquiryInput) {
  if (
    input.subject !== undefined &&
    input.subject !== null &&
    typeof input.subject !== "string"
  ) {
    throw new ApiError("subject must be a string", 400);
  }

  if (
    input.message !== undefined &&
    input.message !== null &&
    typeof input.message !== "string"
  ) {
    throw new ApiError("message must be a string", 400);
  }

  if (
    input.subject !== undefined &&
    input.subject !== null &&
    input.subject.length > 255
  ) {
    throw new ApiError(
      "subject must not exceed 255 characters",
      400,
    );
  }

  if (
    input.message !== undefined &&
    input.message !== null &&
    input.message.length > 5000
  ) {
    throw new ApiError(
      "message must not exceed 5000 characters",
      400,
    );
  }

  if (
    input.status !== undefined &&
    !VALID_STATUSES.includes(input.status)
  ) {
    throw new ApiError("Invalid enquiry status", 400);
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
    const { id: enquiryId } = await context.params;

    const userContext = await getUserContext();

    if (!userContext) {
      throw new ApiError("Unauthorized", 401);
    }

    if (userContext.profile.account_status !== "active") {
      throw new ApiError("Account is not active", 403);
    }

    const enquiry = await getEnquiry(enquiryId);

    const isStaff =
      userContext.role?.name === "administrator" ||
      userContext.role?.name === "sales_customer_service";

    if (isStaff) {
      await requirePermission("enquiries.view");
    } else if (
      userContext.role?.name !== "customer" ||
      enquiry.customer_id !== userContext.user.id
    ) {
      throw new ApiError("Forbidden", 403);
    }

    return NextResponse.json({ data: enquiry });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const { id: enquiryId } = await context.params;

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

    const enquiry = await getEnquiry(enquiryId);

    if (!isStaff) {
      if (
        userContext.role?.name !== "customer" ||
        enquiry.customer_id !== userContext.user.id
      ) {
        throw new ApiError("Forbidden", 403);
      }

      if (enquiry.status !== "new") {
        throw new ApiError(
          "Enquiries can only be edited before staff processing begins",
          403,
        );
      }
    } else {
      await requirePermission("enquiries.manage");
    }

    const body = await parseJson<UpdateEnquiryInput>(request);

    validateUpdateInput(body);

    if (!isStaff) {
      const hasStaffOnlyFields =
        body.status !== undefined ||
        body.assigned_to !== undefined;

      if (hasStaffOnlyFields) {
        throw new ApiError(
          "Customers can only edit the subject and message",
          403,
        );
      }
    }

    const updatedEnquiry = await updateEnquiry(
      enquiryId,
      body,
      {
        userId: userContext.user.id,
        isStaff,
      },
    );

    return NextResponse.json({ data: updatedEnquiry });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
) {
  try {
    const { id: enquiryId } = await context.params;

    await requireRole(["administrator"]);

    await deleteEnquiry(enquiryId);

    return NextResponse.json({
      message: "Enquiry deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
