import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/server/auth/require-permission";
import { ApiError, errorResponse } from "@/server/http/api-error";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const actor = await requirePermission("users.manage");
    const { id } = await params;
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
      throw new ApiError("Invalid staff user ID.", 400);
    }

    const admin = createAdminClient();
    const { data: invitationId, error } = await admin.rpc(
      "bedos_activate_staff_invitation",
      { p_user_id: id, p_actor_id: actor.user.id },
    );

    if (error || !invitationId) {
      if (error?.code === "42501") {
        throw new ApiError("Forbidden", 403);
      }
      if (error?.code === "22023") {
        throw new ApiError("Staff activation requirements not satisfied.", 409);
      }
      console.error("Staff activation failed", error ?? "No record returned");
      throw new ApiError("Unable to activate staff account.", 500);
    }

    return NextResponse.json({
      user_id: id,
      invitation_id: invitationId,
      message: "Staff account activated.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
