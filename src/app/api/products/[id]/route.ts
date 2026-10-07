import { NextResponse } from "next/server";
import {
  deleteProduct,
  getProductById,
  updateProduct,
} from "@/features/products/product.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import type { UpdateProductInput } from "@/features/products/product.types";

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

    const product = await getProductById(id);

    return NextResponse.json({
      product,
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

    const body = (await request.json()) as UpdateProductInput;

    if (
      body.name !== undefined &&
      !body.name.trim()
    ) {
      return NextResponse.json(
        {
          error: "Product name cannot be empty",
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
          error: "Product slug cannot be empty",
        },
        { status: 400 },
      );
    }

    if (
      body.price !== undefined &&
      (typeof body.price !== "number" ||
        body.price < 0)
    ) {
      return NextResponse.json(
        {
          error:
            "Product price must be a non-negative number",
        },
        { status: 400 },
      );
    }

    if (
      body.stock_quantity !== undefined &&
      (!Number.isInteger(body.stock_quantity) ||
        body.stock_quantity < 0)
    ) {
      return NextResponse.json(
        {
          error:
            "Stock quantity must be a non-negative integer",
        },
        { status: 400 },
      );
    }

    const product = await updateProduct(id, body);

    return NextResponse.json({
      product,
      message: "Product updated successfully",
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

    const product = await getProductById(id);

    await deleteProduct(product.id);

    return NextResponse.json({
      message: "Product deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
