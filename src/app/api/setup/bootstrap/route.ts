import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorResponse, ApiError } from "@/server/http/api-error";
import { parseJson } from "@/server/http/parse-json";

type BootstrapRequest = {
  secret: string;
  email: string;
  full_name: string;
  phone?: string;
};

export async function POST(request: Request) {
  try {
    const body = await parseJson<BootstrapRequest>(request);

    const secret = body.secret?.trim();
    const email = body.email?.trim().toLowerCase();
    const fullName = body.full_name?.trim();
    const phone = body.phone?.trim() || null;

    if (!secret || !email || !fullName) {
      throw new ApiError(
        "Secret, email, and full name are required.",
        400,
      );
    }

    const bootstrapSecret = process.env.BEDOS_BOOTSTRAP_SECRET;

    if (!bootstrapSecret || secret !== bootstrapSecret) {
      throw new ApiError("Invalid bootstrap credentials.", 401);
    }

    const admin = createAdminClient();

    const { data: administratorRole, error: roleError } = await admin
      .from("roles")
      .select("id, name")
      .eq("name", "administrator")
      .maybeSingle();

    if (roleError || !administratorRole) {
      throw new ApiError(
        "Unable to verify administrator role.",
        500,
      );
    }

    const { count, error: administratorError } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role_id", administratorRole.id);

    if (administratorError) {
      throw new ApiError(
        "Unable to verify administrator status.",
        500,
      );
    }

    if ((count ?? 0) > 0) {
      throw new ApiError(
        "Administrator already exists. Bootstrap is unavailable.",
        403,
      );
    }

    if (!email.includes("@")) {
      throw new ApiError("Invalid email address.", 400);
    }

    const { data: invitation, error: invitationError } =
      await admin.auth.admin.inviteUserByEmail(email);

    if (invitationError || !invitation.user) {
      throw new ApiError(
        invitationError?.message ?? "Unable to invite administrator.",
        400,
      );
    }

    const invitedUser = invitation.user;

    const { error: profileError } = await admin
      .from("profiles")
      .update({
        full_name: fullName,
        phone,
        role_id: administratorRole.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitedUser.id);

    if (profileError) {
      await admin.auth.admin.deleteUser(invitedUser.id);

      throw new ApiError(
        "Unable to configure administrator.",
        500,
      );
    }

    const { error: auditError } = await admin
      .from("audit_logs")
      .insert({
        actor_id: null,
        action: "administrator_bootstrapped",
        entity_type: "user",
        entity_id: invitedUser.id,
        description: `Bootstrapped first administrator ${email}.`,
        metadata: {
          email,
          full_name: fullName,
          phone,
          role_id: administratorRole.id,
          role_name: administratorRole.name,
        },
      });

    if (auditError) {
      console.error(
        "Failed to write bootstrap audit log:",
        auditError,
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
            id: administratorRole.id,
            name: administratorRole.name,
          },
        },
        message: "Administrator invitation sent successfully.",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}