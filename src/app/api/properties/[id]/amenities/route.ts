import { NextResponse } from "next/server";

import {
  createPropertyAmenity,
  listPropertyAmenities,
} from "@/features/properties/property-amenity.service";

import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

    const amenities = await listPropertyAmenities(id);

    return NextResponse.json({
      amenities,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
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

    const body = (await request.json()) as {
      name?: string;
    };

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    if (!name) {
      return NextResponse.json(
        { error: "Amenity name is required" },
        { status: 400 },
      );
    }

    const amenity = await createPropertyAmenity({
      property_id: id,
      name,
    });

    return NextResponse.json(
      {
        amenity,
        message: "Property amenity created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}