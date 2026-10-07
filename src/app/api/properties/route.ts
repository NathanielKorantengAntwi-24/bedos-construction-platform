import { NextResponse } from "next/server";
import {
  createProperty,
  listPublishedProperties,
} from "@/features/properties/property.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import type { CreatePropertyInput } from "@/features/properties/property.types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const page = Number(searchParams.get("page") ?? "1");
    const limit = Number(searchParams.get("limit") ?? "12");

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return NextResponse.json(
        {
          error: "Invalid pagination parameters",
        },
        { status: 400 },
      );
    }

    const featuredParam = searchParams.get("featured");

    let featured: boolean | undefined;

    if (featuredParam !== null) {
      if (featuredParam !== "true" && featuredParam !== "false") {
        return NextResponse.json(
          {
            error: "featured must be true or false",
          },
          { status: 400 },
        );
      }

      featured = featuredParam === "true";
    }

    const result = await listPublishedProperties({
      search: searchParams.get("search") ?? undefined,
      property_type:
        searchParams.get("property_type") ?? undefined,
      listing_type:
        searchParams.get("listing_type") ?? undefined,
      city: searchParams.get("city") ?? undefined,
      region: searchParams.get("region") ?? undefined,
      featured,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("properties.manage");

    const body = (await request.json()) as CreatePropertyInput;

    if (
      !body.title ||
      !body.slug ||
      !body.property_type ||
      !body.listing_type
    ) {
      return NextResponse.json(
        {
          error:
            "Title, slug, property type, and listing type are required",
        },
        { status: 400 },
      );
    }

    const property = await createProperty(body, context.user.id);

    return NextResponse.json(
      {
        property,
        message: "Property created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}