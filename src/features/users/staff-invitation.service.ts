import type { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";

type AdminClient = ReturnType<typeof createAdminClient>;
type RetryPreparation = {
  invitation_id: string; user_id: string; email: string;
  method: "invite" | "recovery"; attempt_number: number;
};

export function getStaffRecoveryOrigin(): string {
  const configured = process.env.BEDOS_APP_ORIGIN;
  const lab = process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55321";
  const origin = configured || (lab ? "http://127.0.0.1:3000" : "");
  if (!origin) throw new ApiError("Staff recovery is not configured.", 503);
  let url: URL;
  try { url = new URL(origin); } catch { throw new ApiError("Staff recovery origin is invalid.", 503); }
  if (url.origin !== origin.replace(/\/$/, "") ||
      (url.protocol !== "https:" && !(lab && origin === "http://127.0.0.1:3000"))) {
    throw new ApiError("Staff recovery origin must be trusted.", 503);
  }
  return url.origin;
}

function mapRetryError(code?: string): never {
  if (code === "42501") throw new ApiError("Forbidden", 403);
  if (code === "22023") throw new ApiError("Pending staff invitation not eligible for recovery.", 409);
  if (code === "P0001") throw new ApiError("Invitation retry cooldown is active.", 429);
  throw new ApiError("Unable to prepare staff invitation recovery.", 500);
}

export async function retryStaffInvitation(
  admin: AdminClient, id: string, actorId: string, origin: string, expectedInvitationId?: string,
) {
  const { data, error } = await admin.rpc("bedos_prepare_staff_invitation_retry", { p_user_id: id, p_actor_id: actorId });
  if (error || !data) {
    if (!error) throw new ApiError("Unable to prepare invitation retry.", 500);
    mapRetryError(error.code);
  }
  const prepared = data as unknown as RetryPreparation;
  if (prepared.user_id !== id || typeof prepared.invitation_id !== "string" ||
      (expectedInvitationId !== undefined && prepared.invitation_id !== expectedInvitationId) ||
      typeof prepared.email !== "string" || !["invite", "recovery"].includes(prepared.method) ||
      !Number.isSafeInteger(prepared.attempt_number) || prepared.attempt_number < 1) {
    throw new ApiError("Unrecognized invitation retry data.", 500);
  }
  let accepted = false;
  try {
    const { data: existing, error: userError } = await admin.auth.admin.getUserById(id);
    if (userError || !existing.user || existing.user.id !== id || existing.user.email !== prepared.email ||
        (!!existing.user.email_confirmed_at !== (prepared.method === "recovery"))) {
      throw new Error("Invitation Auth identity or method changed during recovery");
    }
    if (prepared.method === "invite") {
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(prepared.email, { redirectTo: `${origin}/` });
      if (inviteError || invited.user?.id !== id) throw new Error("Supabase invitation request failed or identity changed");
    } else {
      const { error: recoveryError } = await admin.auth.resetPasswordForEmail(prepared.email, { redirectTo: `${origin}/` });
      if (recoveryError) throw new Error("Supabase password recovery request failed");
    }
    accepted = true;
  } catch {
    console.error("Staff invitation retry dispatch failed");
  }
  const { data: finishedId, error: finishError } = await admin.rpc("bedos_finish_staff_invitation_retry", {
    p_user_id: id, p_actor_id: actorId, p_attempt_number: prepared.attempt_number, p_accepted: accepted,
  });
  if (finishError || finishedId !== prepared.invitation_id) {
    console.error("Staff invitation retry outcome audit failed", { code: finishError?.code });
    throw new ApiError("Unable to record invitation recovery result securely.", 500);
  }
  if (!accepted) throw new ApiError("Supabase did not accept the recovery email request.", 502);
  return { user_id: id, invitation_id: prepared.invitation_id, recovery_method: prepared.method, message: "Staff onboarding email request accepted." };
}

export function parseResumeReason(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ApiError("Request body must be an object.", 400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "reason") || typeof input.reason !== "string" ||
      !input.reason.trim() || input.reason.trim().length > 500 || input.reason.includes("\0")) {
    throw new ApiError("Only a reason between 1 and 500 characters is required.", 400);
  }
  return input.reason.trim();
}

export async function resumeStaffInvitation(admin: AdminClient, id: string, actorId: string, reason: string, origin: string) {
  const { data, error } = await admin.rpc("bedos_setup_staff_invitation", {
    p_user_id: id, p_actor_id: actorId, p_reason: reason, p_resume: true,
  });
  if (error) {
    if (error.code === "42501") throw new ApiError("Forbidden", 403);
    if (error.code === "22023") throw new ApiError("Invalid staff setup request.", 400);
    if (error.code === "P0002") throw new ApiError("User not found", 404);
    if (error.code === "P0001") throw new ApiError("Staff setup is not eligible for resumption.", 409);
    console.error("Staff invitation setup resume failed", { code: error.code });
    throw new ApiError("Unable to resume staff invitation setup.", 500);
  }
  if (typeof data !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(data)) {
    throw new ApiError("Unable to resume staff invitation setup.", 500);
  }
  return retryStaffInvitation(admin, id, actorId, origin, data);
}
