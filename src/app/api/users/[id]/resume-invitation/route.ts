import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/server/auth/require-permission";
import { ApiError, errorResponse } from "@/server/http/api-error";
import { parseJson } from "@/server/http/parse-json";
import { validateUserId } from "@/features/users/user.service";
import { getStaffRecoveryOrigin, parseResumeReason, resumeStaffInvitation } from "@/features/users/staff-invitation.service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePermission("users.manage");
    const { id } = await params;
    validateUserId(id);
    if ([...new URL(request.url).searchParams.keys()].length) throw new ApiError("Unknown resume query parameter.", 400);
    const reason = parseResumeReason(await parseJson<unknown>(request));
    const origin = getStaffRecoveryOrigin();
    const result = await resumeStaffInvitation(createAdminClient(), id.toLowerCase(), actor.user.id, reason, origin);
    return NextResponse.json(result, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
