import { NextResponse } from "next/server";
import {
  createPropertyFeature,
  listPropertyFeatures,
} from "@/features/properties/property-feature.service";
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

    const features = await listPropertyFeatures(id);

    return NextResponse.json({
      features,
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
      value?: string | null;
    };

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    if (!name) {
      return NextResponse.json(
        { error: "Feature name is required" },
        { status: 400 },
      );
    }

    const value =
      body.value === null || body.value === undefined
        ? null
        : typeof body.value === "string"
          ? body.value.trim()
          : null;

    const feature = await createPropertyFeature({
      property_id: id,
      name,
      value,
    });

    return NextResponse.json(
      {
        feature,
        message: "Property feature created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}