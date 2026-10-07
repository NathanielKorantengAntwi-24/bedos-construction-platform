import { NextResponse } from "next/server";
import {
  createService,
  listServices,
} from "@/features/services/service.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import type { CreateServiceInput } from "@/features/services/service.types";

export async function GET() {
  try {
    await requirePermission("services.view");

    const services = await listServices();

    return NextResponse.json({ services });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("services.manage");

    const body = (await request.json()) as CreateServiceInput;

    if (!body.name?.trim() || !body.slug?.trim()) {
      return NextResponse.json(
        {
          error: "Service name and slug are required",
        },
        { status: 400 },
      );
    }

    const allowedStatuses = [
      "draft",
      "published",
      "archived",
    ] as const;

    if (
      body.status !== undefined &&
      !allowedStatuses.includes(body.status)
    ) {
      return NextResponse.json(
        {
          error:
            "Service status must be draft, published, or archived",
        },
        { status: 400 },
      );
    }

    const service = await createService(
      {
        ...body,
        name: body.name.trim(),
        slug: body.slug.trim(),
        description: body.description?.trim() || null,
      },
      context.user.id,
    );

    return NextResponse.json(
      {
        service,
        message: "Service created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}