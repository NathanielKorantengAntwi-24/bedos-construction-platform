import { NextResponse } from "next/server";

import {
  deletePropertyImage,
  updatePropertyImage,
} from "@/features/properties/property-image.service";

import { errorResponse } from "@/server/http/api-error";

import { requireRole } from "@/server/auth/require-role";
import { requirePermission } from "@/server/auth/require-permission";

import type { UpdatePropertyImageInput } from "@/features/properties/property-image.types";

type RouteContext = {
  params: Promise<{
    id: string;
    imageId: string;
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

    const { id, imageId } = await context.params;

    if (!isValidUuid(id) || !isValidUuid(imageId)) {
      return NextResponse.json(
        { error: "Invalid property or image ID" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as UpdatePropertyImageInput;

    const image = await updatePropertyImage(id, imageId, body);

    return NextResponse.json({
      image,
      message: "Property image updated successfully",
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

    const { id, imageId } = await context.params;

    if (!isValidUuid(id) || !isValidUuid(imageId)) {
      return NextResponse.json(
        { error: "Invalid property or image ID" },
        { status: 400 },
      );
    }

await deletePropertyImage(id, imageId);
    return NextResponse.json({
      property_id: id,
      image_id: imageId,
      message: "Property image deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}