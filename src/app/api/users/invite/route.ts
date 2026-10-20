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
    const parsed = await parseJson<unknown>(request);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new ApiError("Request body must be an object.", 400);
    }

    const body = parsed as InviteUserRequest;

    if (
      typeof body.email !== "string" ||
      typeof body.full_name !== "string" ||
      typeof body.role_id !== "string" ||
      (body.phone !== undefined &&
        body.phone !== null &&
        typeof body.phone !== "string")
    ) {
      throw new ApiError("Invalid invitation details.", 400);
    }

    const email = body.email.trim().toLowerCase();
    const fullName = body.full_name.trim();
    const phone =
      typeof body.phone === "string"
        ? body.phone.trim() || null
        : null;
    const roleId = body.role_id.trim();

    if (!email || !fullName || !roleId) {
      throw new ApiError(
        "Email, full name, and role are required.",
        400,
      );
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      fullName.length > 200 ||
      (phone !== null && phone.length > 40)
    ) {
      throw new ApiError("Invalid invitation details.", 400);
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
      .eq("id", invitedUser.id)
      .select("id")
      .single();

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