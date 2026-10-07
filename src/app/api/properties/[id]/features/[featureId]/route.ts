import { NextResponse } from "next/server";

import {
  deletePropertyFeature,
  updatePropertyFeature,
} from "@/features/properties/property-feature.service";

import { errorResponse } from "@/server/http/api-error";

import { requireRole } from "@/server/auth/require-role";
import { requirePermission } from "@/server/auth/require-permission";

import type { UpdatePropertyFeatureInput } from "@/features/properties/property-feature.types";

type RouteContext = {
  params: Promise<{
    id: string;
    featureId: string;
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

    const { id, featureId } = await context.params;

    if (!isValidUuid(id) || !isValidUuid(featureId)) {
      return NextResponse.json(
        { error: "Invalid property or feature ID" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as UpdatePropertyFeatureInput;

    const updateData: UpdatePropertyFeatureInput = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json(
          { error: "Feature name cannot be empty" },
          { status: 400 },
        );
      }

      updateData.name = body.name.trim();
    }

    if (body.value !== undefined) {
      if (body.value !== null && typeof body.value !== "string") {
        return NextResponse.json(
          { error: "Feature value must be a string or null" },
          { status: 400 },
        );
      }

      updateData.value =
        typeof body.value === "string"
          ? body.value.trim()
          : null;
    }

    const feature = await updatePropertyFeature(
      id,
      featureId,
      updateData,
    );

    return NextResponse.json({
      feature,
      message: "Property feature updated successfully",
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

    const { id, featureId } = await context.params;

    if (!isValidUuid(id) || !isValidUuid(featureId)) {
      return NextResponse.json(
        { error: "Invalid property or feature ID" },
        { status: 400 },
      );
    }

    await deletePropertyFeature(id, featureId);

    return NextResponse.json({
      property_id: id,
      feature_id: featureId,
      message: "Property feature deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}