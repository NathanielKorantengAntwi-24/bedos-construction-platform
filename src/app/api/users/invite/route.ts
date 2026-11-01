import { randomUUID } from "node:crypto";
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
    const roleId = body.role_id.trim().toLowerCase();

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

    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(roleId)) {
      throw new ApiError("Invalid role ID.", 400);
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

    if (
      !["content_manager", "finance", "sales_customer_service"].includes(
        role.name,
      )
    ) {
      throw new ApiError(
        "Role is not eligible for staff invitation.",
        400,
      );
    }

    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        app_metadata: {
          bedos_staff_invitation: {
            version: 1, request_id: randomUUID(), requested_role_id: role.id,
            created_by: context.user.id, email, full_name: fullName, phone,
          },
        },
        user_metadata: {
          full_name: fullName,
          phone,
          bedos_staff_onboarding_pending: true,
        },
      });

    if (createError) {
      if (createError.code === "email_exists") {
        throw new ApiError("Account already exists.", 409);
      }

      throw new ApiError("Unable to create invited user.", 500);
    }

    if (!created.user) {
      throw new ApiError("Unable to create invited user.", 500);
    }

    // Configuration, trusted approval and audit commit or roll back together.
    const { data: invitationRecordId, error: setupError } = await admin.rpc(
      "bedos_setup_staff_invitation",
      { p_user_id: created.user.id, p_actor_id: context.user.id,
        p_reason: "Initial staff invitation setup", p_resume: false },
    );
    if (setupError || typeof invitationRecordId !== "string" ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(invitationRecordId)) {
      console.error("Staff invitation setup failed", { code: setupError?.code });
      // Preserve the inactive identity and server-owned proof for controlled resume.
      throw new ApiError("Unable to configure and authorize staff invitation.", 500);
    }

    const { data: invitation, error: invitationError } =
      await admin.auth.admin.inviteUserByEmail(email);

    if (invitationError || !invitation?.user) {
      console.error("Staff invitation email dispatch failed", {
        code: invitationError?.code,
        status: invitationError?.status,
      });
      throw new ApiError(
        "Unable to send staff invitation.",
        502,
      );
    }

    if (invitation.user.id !== created.user.id) {
      console.error("Staff invitation Auth user ID mismatch");

      throw new ApiError(
        "Invitation identity verification failed.",
        500,
      );
    }

    const invitedUser = invitation.user;

    // Capture the invited user's credential state AFTER Supabase sends the
    // invitation. A populated Auth password hash is not proof of onboarding.
    // The staff member must subsequently change their password before
    // administrator activation can succeed.
    const { data: baselineId, error: baselineError } = await admin.rpc(
      "bedos_record_staff_invitation_password_baseline",
      { p_user_id: invitedUser.id },
    );

    if (baselineError || baselineId !== invitationRecordId) {
      console.error(
        "Staff invitation password baseline failed",
        { code: baselineError?.code },
      );
      throw new ApiError(
        "Unable to finalize staff invitation securely.",
        500,
      );
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
