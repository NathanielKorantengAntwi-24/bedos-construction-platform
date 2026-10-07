import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/server/auth/require-permission";
import { errorResponse, ApiError } from "@/server/http/api-error";
import { parseJson } from "@/server/http/parse-json";

type InviteUserRequest = {
  email: string;
  full_name: string;
  phone?: string;
  role_id: string;
};

export async function POST(request: Request) {
  try {
    const context = await requirePermission("users.manage");
    const body = await parseJson<InviteUserRequest>(request);

    const email = body.email?.trim().toLowerCase();
    const fullName = body.full_name?.trim();
    const phone = body.phone?.trim() || null;
    const roleId = body.role_id?.trim();

    if (!email || !fullName || !roleId) {
      throw new ApiError(
        "Email, full name, and role are required.",
        400,
      );
    }

    if (!email.includes("@")) {
      throw new ApiError("Invalid email address.", 400);
    }

    const admin = createAdminClient();

    const { data: role, error: roleError } = await admin
      .from("roles")
      .select("id, name")
      .eq("id", roleId)
      .maybeSingle();

    if (roleError) {
      throw new ApiError("Unable to verify role.", 500);
    }

    if (!role) {
      throw new ApiError("Invalid role.", 400);
    }

    const { data: invitation, error: invitationError } =
      await admin.auth.admin.inviteUserByEmail(email);

    if (invitationError || !invitation.user) {
      throw new ApiError(
        invitationError?.message ?? "Unable to invite user.",
        400,
      );
    }

    const invitedUser = invitation.user;

    const { error: profileError } = await admin
      .from("profiles")
      .update({
        full_name: fullName,
        phone,
        role_id: role.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitedUser.id);

    if (profileError) {
      await admin.auth.admin.deleteUser(invitedUser.id);

      throw new ApiError(
        "Unable to configure invited user.",
        500,
      );
    }

    const { error: auditError } = await admin
      .from("audit_logs")
      .insert({
        actor_id: context.user.id,
        action: "user_invited",
        entity_type: "user",
        entity_id: invitedUser.id,
        description: `Invited user ${email} with role ${role.name}.`,
        metadata: {
          email,
          full_name: fullName,
          phone,
          role_id: role.id,
          role_name: role.name,
        },
      });

    if (auditError) {
      console.error("Failed to write invitation audit log:", auditError);
    }

    return NextResponse.json(
      {
        user: {
          id: invitedUser.id,
          email: invitedUser.email,
        },
        profile: {
          full_name: fullName,
          phone,
          role: {
            id: role.id,
            name: role.name,
          },
        },
        message: "User invited successfully.",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}