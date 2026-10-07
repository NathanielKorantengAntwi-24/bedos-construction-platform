import { NextResponse } from "next/server";

import {
  deletePropertyFloorPlan,
  updatePropertyFloorPlan,
} from "@/features/properties/property-floor-plan.service";

import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import { requireRole } from "@/server/auth/require-role";

import type { UpdatePropertyFloorPlanInput } from "@/features/properties/property-floor-plan.types";

type RouteContext = {
  params: Promise<{
    id: string;
    floorPlanId: string;
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

    const { id, floorPlanId } = await context.params;

    if (!isValidUuid(id) || !isValidUuid(floorPlanId)) {
      return NextResponse.json(
        { error: "Invalid property or floor plan ID" },
        { status: 400 },
      );
    }

    const body =
      (await request.json()) as UpdatePropertyFloorPlanInput;

    const updateData: UpdatePropertyFloorPlanInput = {};

    if (body.title !== undefined) {
      if (
        body.title !== null &&
        typeof body.title !== "string"
      ) {
        return NextResponse.json(
          { error: "Title must be a string or null" },
          { status: 400 },
        );
      }

      updateData.title =
        typeof body.title === "string"
          ? body.title.trim() || null
          : null;
    }

    if (body.description !== undefined) {
      if (
        body.description !== null &&
        typeof body.description !== "string"
      ) {
        return NextResponse.json(
          { error: "Description must be a string or null" },
          { status: 400 },
        );
      }

      updateData.description =
        typeof body.description === "string"
          ? body.description.trim() || null
          : null;
    }

    if (body.display_order !== undefined) {
      if (
        !Number.isInteger(body.display_order) ||
        body.display_order < 0
      ) {
        return NextResponse.json(
          {
            error:
              "display_order must be a non-negative integer",
          },
          { status: 400 },
        );
      }

      updateData.display_order = body.display_order;
    }

    const floorPlan = await updatePropertyFloorPlan(
      id,
      floorPlanId,
      updateData,
    );

    return NextResponse.json({
      floorPlan,
      message: "Property floor plan updated successfully",
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

    const { id, floorPlanId } = await context.params;

    if (!isValidUuid(id) || !isValidUuid(floorPlanId)) {
      return NextResponse.json(
        { error: "Invalid property or floor plan ID" },
        { status: 400 },
      );
    }

    await deletePropertyFloorPlan(id, floorPlanId);

    return NextResponse.json({
      property_id: id,
      floor_plan_id: floorPlanId,
      message: "Property floor plan deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}