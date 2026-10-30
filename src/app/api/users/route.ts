import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/require-permission";
import { errorResponse } from "@/server/http/api-error";
import { listUsers, parseUserListQuery } from "@/features/users/user.service";

export async function GET(request: Request) {
  try {
    const actor = await requirePermission("users.view");
    const input = parseUserListQuery(new URL(request.url).searchParams);
    return NextResponse.json(await listUsers(actor.user.id, input), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
