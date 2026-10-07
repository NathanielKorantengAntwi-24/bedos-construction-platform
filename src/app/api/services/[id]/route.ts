import { NextResponse } from "next/server";
import {
  deleteService,
  getServiceById,
  updateService,
} from "@/features/services/service.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import type { UpdateServiceInput } from "@/features/services/service.types";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const ALLOWED_STATUSES = [
  "draft",
  "published",
  "archived",
] as const;

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  try {
    await requirePermission("services.view");

    const { id } = await context.params;

    const service = await getServiceById(id);

    return NextResponse.json({
      service,
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

    const body = (await request.json()) as UpdateServiceInput;

    if (
      body.name !== undefined &&
      !body.name.trim()
    ) {
      return NextResponse.json(
        {
          error: "Service name cannot be empty",
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
          error: "Service slug cannot be empty",
        },
        { status: 400 },
      );
    }

    if (
      body.status !== undefined &&
      !ALLOWED_STATUSES.includes(body.status)
    ) {
      return NextResponse.json(
        {
          error:
            "Service status must be draft, published, or archived",
        },
        { status: 400 },
      );
    }

    const service = await updateService(id, {
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
      service,
      message: "Service updated successfully",
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

    await getServiceById(id);

    await deleteService(id);

    return NextResponse.json({
      message: "Service deleted successfully",
    });
  } catch (error) {
    return errorResponse(error);
  }
}