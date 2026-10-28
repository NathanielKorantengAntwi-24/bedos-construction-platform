import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/server/auth/require-permission";
import { ApiError, errorResponse } from "@/server/http/api-error";

type RouteParams = { params: Promise<{ id: string }> };
type RetryPreparation = {
  invitation_id: string;
  user_id: string;
  email: string;
  method: "invite" | "recovery";
  attempt_number: number;
};

function mapRetryError(code?: string): never {
  if (code === "42501") throw new ApiError("Forbidden", 403);
  if (code === "22023") {
    throw new ApiError("Pending staff invitation not eligible for recovery.", 409);
  }
  if (code === "P0001") {
    throw new ApiError("Invitation retry cooldown is active.", 429);
  }
  throw new ApiError("Unable to prepare staff invitation recovery.", 500);
}

function recoveryOrigin(): string {
  // Explicit trusted origin for production. Never use the request Host header.
  const configured = process.env.BEDOS_APP_ORIGIN;
  const lab = process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55321";
  const origin = configured || (lab ? "http://127.0.0.1:3000" : "");
  if (!origin) throw new ApiError("Staff recovery is not configured.", 503);

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ApiError("Staff recovery origin is invalid.", 503);
  }
  if (url.origin !== origin.replace(/\/$/, "") ||
      (url.protocol !== "https:" && !(lab && origin === "http://127.0.0.1:3000"))) {
    throw new ApiError("Staff recovery origin must be trusted.", 503);
  }
  return url.origin;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const actor = await requirePermission("users.manage");
    const { id: requestedId } = await params;
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestedId)) {
      throw new ApiError("Invalid staff user ID.", 400);
    }
    const id = requestedId.toLowerCase();

    // Check configuration before mutating retry state.
    const origin = recoveryOrigin();
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("bedos_prepare_staff_invitation_retry", {
      p_user_id: id,
      p_actor_id: actor.user.id,
    });
    if (error || !data) {
      if (!error) throw new ApiError("Unable to prepare invitation retry.", 500);
      mapRetryError(error.code);
    }

    const prepared = data as unknown as RetryPreparation;
    if (
      prepared.user_id !== id ||
      typeof prepared.invitation_id !== "string" ||
      typeof prepared.email !== "string" ||
      !["invite", "recovery"].includes(prepared.method) ||
      !Number.isSafeInteger(prepared.attempt_number) ||
      prepared.attempt_number < 1
    ) {
      throw new ApiError("Unrecognized invitation retry data.", 500);
    }

    let accepted = false;
    try {
      const { data: existing, error: userError } =
        await admin.auth.admin.getUserById(id);
      if (userError || !existing.user ||
          existing.user.id !== id || existing.user.email !== prepared.email ||
          (!!existing.user.email_confirmed_at !== (prepared.method === "recovery"))) {
        throw new Error("Invitation Auth identity or method changed during recovery");
      }

      if (prepared.method === "invite") {
        const { data: invited, error: inviteError } =
          await admin.auth.admin.inviteUserByEmail(prepared.email, {
            redirectTo: `${origin}/`,
          });
        if (inviteError || invited.user?.id !== id) {
          throw new Error("Supabase invitation request failed or identity changed");
        }
      } else {
        const { error: recoveryError } =
          await admin.auth.resetPasswordForEmail(prepared.email, {
            redirectTo: `${origin}/auth/set-password`,
          });
        if (recoveryError) {
          throw new Error("Supabase password recovery request failed");
        }
      }
      accepted = true;
    } catch (dispatchError) {
      // Never expose provider details or recovery links in the API response.
      console.error("Staff invitation retry dispatch failed", dispatchError);
    }

    const { data: finishedId, error: finishError } = await admin.rpc(
      "bedos_finish_staff_invitation_retry",
      {
        p_user_id: id,
        p_actor_id: actor.user.id,
        p_attempt_number: prepared.attempt_number,
        p_accepted: accepted,
      },
    );
    if (finishError || finishedId !== prepared.invitation_id) {
      console.error("Staff invitation retry outcome audit failed", finishError);
      throw new ApiError("Unable to record invitation recovery result securely.", 500);
    }
    if (!accepted) {
      throw new ApiError("Supabase did not accept the recovery email request.", 502);
    }

    return NextResponse.json(
      {
        user_id: id,
        invitation_id: prepared.invitation_id,
        recovery_method: prepared.method,
        message: "Staff onboarding email request accepted.",
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
