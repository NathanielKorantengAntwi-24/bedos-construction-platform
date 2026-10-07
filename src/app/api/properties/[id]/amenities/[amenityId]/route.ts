import { NextResponse } from "next/server";

import {
  deletePropertyAmenity,
  updatePropertyAmenity,
} from "@/features/properties/property-amenity.service";

import { errorResponse } from "@/server/http/api-error";

import { requireRole } from "@/server/auth/require-role";
import { requirePermission } from "@/server/auth/require-permission";

import type { UpdatePropertyAmenityInput } from "@/features/properties/property-amenity.types";

type RouteContext = {
  params: Promise<{
    id: string;
    amenityId: string;
  }>;
};

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    await requirePermission("properties.manage");

    const { id, amenityId } = await context.params;

    if (!isValidUuid(id) || !isValidUuid(amenityId)) {
      return NextResponse.json(
        { error: "Invalid property or amenity ID" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as UpdatePropertyAmenityInput;

    const updateData: UpdatePropertyAmenityInput = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json(
          { error: "Amenity name cannot be empty" },
          { status: 400 },
        );
      }

      updateData.name = body.name.trim();
    }

    const amenity = await updatePropertyAmenity(
      id,
      amenityId,
      updateData,
    );

    return NextResponse.json({
      amenity,
      message: "Property amenity updated successfully",
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
    await requireRole(["administrator"]);

    const { id, amenityId } = await context.params;

    if (!isValidUuid(id) || !isValidUuid(amenityId)) {
      return NextResponse.json(
        { error: "Invalid property or amenity ID" },
        { status: 400 },
      );
    }

    await deletePropertyAmenity(id, amenityId);

    return NextResponse.json({
      property_id: id,
      amenity_id: amenityId,
      message: "Property amenity deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}