import { NextResponse } from "next/server";
import {
  deleteServiceCategory,
  getServiceCategoryById,
  updateServiceCategory,
} from "@/features/services/service-category.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import type { UpdateServiceCategoryInput } from "@/features/services/service-category.types";

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
    await requirePermission("services.view");

    const { id } = await context.params;

    const category = await getServiceCategoryById(id);

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
    await requirePermission("services.manage");

    const { id } = await context.params;

    const body =
      (await request.json()) as UpdateServiceCategoryInput;

    if (
      body.name !== undefined &&
      !body.name.trim()
    ) {
      return NextResponse.json(
        {
          error: "Service category name cannot be empty",
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
          error: "Service category slug cannot be empty",
        },
        { status: 400 },
      );
    }

    const category = await updateServiceCategory(id, {
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
      message: "Service category updated successfully",
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
    await requirePermission("services.manage");

    const { id } = await context.params;

    await getServiceCategoryById(id);

    await deleteServiceCategory(id);

    return NextResponse.json({
      message: "Service category deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}