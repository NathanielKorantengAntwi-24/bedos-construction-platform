import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/require-permission";
import { ApiError, errorResponse } from "@/server/http/api-error";
import { parseJson } from "@/server/http/parse-json";
import { parseUserRoleInput, updateUserRole, validateUserId } from "@/features/users/user.service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePermission("users.manage");
    const { id } = await params;
    validateUserId(id);
    if ([...new URL(request.url).searchParams.keys()].length) {
      throw new ApiError("Unknown account role query parameter.", 400);
    }
    const input = parseUserRoleInput(await parseJson<unknown>(request));
    return NextResponse.json(await updateUserRole(actor.user.id, id, input), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
