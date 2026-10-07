import { NextResponse } from "next/server";
import {
  deleteProductCategory,
  getProductCategoryById,
  updateProductCategory,
} from "@/features/products/product-category.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import type { UpdateProductCategoryInput } from "@/features/products/product-category.types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  try {
    await requirePermission("products.view");

    const { id } = await context.params;

    const category = await getProductCategoryById(id);

    return NextResponse.json({
      category,
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
    await requirePermission("products.manage");

    const { id } = await context.params;

    const body = (await request.json()) as UpdateProductCategoryInput;

    if (
      body.name !== undefined &&
      !body.name.trim()
    ) {
      return NextResponse.json(
        {
          error: "Product category name cannot be empty",
        },
        { status: 400 },
      );
    }

    if (
      body.slug !== undefined &&
      !body.slug.trim()
    ) {
      return NextResponse.json(
        {
          error: "Product category slug cannot be empty",
        },
        { status: 400 },
      );
    }

    const category = await updateProductCategory(id, {
      ...body,
      ...(body.name !== undefined && {
        name: body.name.trim(),
      }),
      ...(body.slug !== undefined && {
        slug: body.slug.trim(),
      }),
      ...(body.description !== undefined && {
        description: body.description?.trim() || null,
      }),
    });

    return NextResponse.json({
      category,
      message: "Product category updated successfully",
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
    await requirePermission("products.manage");

    const { id } = await context.params;

    await getProductCategoryById(id);

    await deleteProductCategory(id);

    return NextResponse.json({
      message: "Product category deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
