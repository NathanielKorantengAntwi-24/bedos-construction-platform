import { NextResponse } from "next/server";
import {
  deleteProperty,
  getPropertyById,
  updateProperty,
} from "@/features/properties/property.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import type { UpdatePropertyInput } from "@/features/properties/property.types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const VALID_STATUSES = [
  "draft",
  "published",
  "reserved",
  "sold",
  "unavailable",
  "archived",
] as const;

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { error: "Invalid property ID" },
        { status: 400 },
      );
    }

    const property = await getPropertyById(id);

    return NextResponse.json({
      property,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    await requirePermission("properties.manage");

    const { id } = await context.params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { error: "Invalid property ID" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as UpdatePropertyInput;

    if (
      body.status !== undefined &&
      !VALID_STATUSES.includes(body.status)
    ) {
      return NextResponse.json(
        {
          error: "Invalid property status",
        },
        { status: 400 },
      );
    }

    const property = await updateProperty(id, body);

    return NextResponse.json({
      property,
      message: "Property updated successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
) {
  try {
    await requirePermission("properties.manage");

    const { id } = await context.params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { error: "Invalid property ID" },
        { status: 400 },
      );
    }

    const property = await getPropertyById(id);

    await deleteProperty(id);

    return NextResponse.json({
      property_id: property.id,
      message: "Property deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}