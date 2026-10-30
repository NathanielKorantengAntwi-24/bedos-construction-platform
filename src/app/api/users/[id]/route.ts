import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/require-permission";
import { ApiError, errorResponse } from "@/server/http/api-error";
import { getUserById } from "@/features/users/user.service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePermission("users.view");
    if ([...new URL(request.url).searchParams.keys()].length) throw new ApiError("Unknown user query parameter.", 400);
    const { id } = await params;
    return NextResponse.json({ user: await getUserById(actor.user.id, id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
