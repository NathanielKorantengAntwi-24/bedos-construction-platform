import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { requirePermission } from "@/server/auth/require-permission";
import { ApiError, errorResponse } from "@/server/http/api-error";
import { parseJson } from "@/server/http/parse-json";
import {
  createEnquiry,
  listCustomerEnquiries,
  listEnquiries,
} from "@/features/enquiries/enquiry.service";
import type {
  CreateEnquiryInput,
  EnquiryType,
} from "@/features/enquiries/enquiry.types";

const VALID_ENQUIRY_TYPES: EnquiryType[] = [
  "property_enquiry",
  "quote_request",
  "construction_request",
  "maintenance_request",
  "painting_request",
  "tiling_request",
  "interior_design_request",
  "product_enquiry",
  "general_contact",
];

export async function GET() {
  try {
    const userContext = await getUserContext();

    if (!userContext) {
      throw new ApiError("Unauthorized", 401);
    }

    if (userContext.profile.account_status !== "active") {
      throw new ApiError("Account is not active", 403);
    }

    if (
      userContext.role?.name === "administrator" ||
      userContext.role?.name === "sales_customer_service"
    ) {
      await requirePermission("enquiries.view");

      const enquiries = await listEnquiries();

      return NextResponse.json({ data: enquiries });
    }

    if (userContext.role?.name === "customer") {
      const enquiries = await listCustomerEnquiries(
        userContext.user.id,
      );

      return NextResponse.json({ data: enquiries });
    }

    throw new ApiError("Forbidden", 403);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userContext = await getUserContext();

    if (
      userContext &&
      userContext.profile.account_status !== "active"
    ) {
      throw new ApiError("Account is not active", 403);
    }

    if (
      userContext &&
      userContext.role?.name !== "customer"
    ) {
      throw new ApiError(
        "Only customers can submit authenticated enquiries",
        403,
      );
    }

    const body = await parseJson<
      Omit<CreateEnquiryInput, "customer_id">
    >(request);

    if (
      !body.enquiry_type ||
      !VALID_ENQUIRY_TYPES.includes(body.enquiry_type)
    ) {
      throw new ApiError("Invalid enquiry type", 400);
    }

    if (
      body.subject !== undefined &&
      body.subject !== null &&
      typeof body.subject !== "string"
    ) {
      throw new ApiError("subject must be a string", 400);
    }

    if (
      body.message !== undefined &&
      body.message !== null &&
      typeof body.message !== "string"
    ) {
      throw new ApiError("message must be a string", 400);
    }

    if (
      body.subject !== undefined &&
      body.subject !== null &&
      body.subject.length > 255
    ) {
      throw new ApiError(
        "subject must not exceed 255 characters",
        400,
      );
    }

    if (
      body.message !== undefined &&
      body.message !== null &&
      body.message.length > 5000
    ) {
      throw new ApiError(
        "message must not exceed 5000 characters",
        400,
      );
    }

    const input: CreateEnquiryInput = {
      enquiry_type: body.enquiry_type,
      subject: body.subject ?? null,
      message: body.message ?? null,
      property_id: body.property_id ?? null,
      product_id: body.product_id ?? null,
      service_id: body.service_id ?? null,
    };

    const enquiry = await createEnquiry(
      input,
      userContext?.user.id ?? null,
    );

    return NextResponse.json(
      {
        data: enquiry,
        message: "Enquiry submitted successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
