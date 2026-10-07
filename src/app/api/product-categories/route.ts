import { NextResponse } from "next/server";
import {
  createProductCategory,
  listProductCategories,
} from "@/features/products/product-category.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import type { CreateProductCategoryInput } from "@/features/products/product-category.types";

export async function GET() {
  try {
    await requirePermission("products.view");

    const categories = await listProductCategories();

    return NextResponse.json({ categories });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission("products.manage");

    const body = (await request.json()) as CreateProductCategoryInput;

    if (!body.name?.trim() || !body.slug?.trim()) {
      return NextResponse.json(
        {
          error: "Product category name and slug are required",
        },
        { status: 400 },
      );
    }

    const category = await createProductCategory({
      name: body.name.trim(),
      slug: body.slug.trim(),
      description: body.description?.trim() || null,
    });

    return NextResponse.json(
      {
        category,
        message: "Product category created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
