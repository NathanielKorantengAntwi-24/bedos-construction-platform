import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/server/auth/require-permission";
import { ApiError, errorResponse } from "@/server/http/api-error";
import { getStaffRecoveryOrigin, retryStaffInvitation } from "@/features/users/staff-invitation.service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePermission("users.manage");
    const { id } = await params;
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new ApiError("Invalid staff user ID.", 400);
    const origin = getStaffRecoveryOrigin();
    return NextResponse.json(await retryStaffInvitation(createAdminClient(), id.toLowerCase(), actor.user.id, origin), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}