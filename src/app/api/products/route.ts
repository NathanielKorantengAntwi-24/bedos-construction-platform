import { NextResponse } from "next/server";
import {
  createProduct,
  listProducts,
} from "@/features/products/product.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import type { CreateProductInput } from "@/features/products/product.types";

export async function GET() {
  try {
    await requirePermission("products.view");

    const products = await listProducts();

    return NextResponse.json({
      products,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("products.manage");

    const body = (await request.json()) as CreateProductInput;

    if (!body.name?.trim() || !body.slug?.trim()) {
      return NextResponse.json(
        {
          error: "Product name and slug are required",
        },
        { status: 400 },
      );
    }

    if (typeof body.price !== "number" || body.price < 0) {
      return NextResponse.json(
        {
          error: "Product price must be a non-negative number",
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

    const product = await createProduct(
      body,
      context.user.id,
    );

    return NextResponse.json(
      {
        product,
        message: "Product created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
