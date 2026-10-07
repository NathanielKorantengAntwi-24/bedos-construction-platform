import { NextResponse } from "next/server";
import {
  createServiceCategory,
  listServiceCategories,
} from "@/features/services/service-category.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import type { CreateServiceCategoryInput } from "@/features/services/service-category.types";

export async function GET() {
  try {
    await requirePermission("services.view");

    const categories = await listServiceCategories();

    return NextResponse.json({ categories });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("services.manage");

    const body =
      (await request.json()) as CreateServiceCategoryInput;

    if (!body.name?.trim() || !body.slug?.trim()) {
      return NextResponse.json(
        {
          error: "Service category name and slug are required",
        },
        { status: 400 },
      );
    }

    const category = await createServiceCategory({
      name: body.name.trim(),
      slug: body.slug.trim(),
      description: body.description?.trim() || null,
    });

    return NextResponse.json(
      {
        category,
        message: "Service category created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}