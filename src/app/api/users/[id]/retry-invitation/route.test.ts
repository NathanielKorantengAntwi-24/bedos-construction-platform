import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminClient: vi.fn(),
  permission: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.adminClient }));
vi.mock("@/server/auth/require-permission", () => ({ requirePermission: mocks.permission }));

import { ApiError } from "@/server/http/api-error";
import { POST } from "./route";

const userId = "10000000-0000-4000-8000-000000000101";
const actorId = "20000000-0000-4000-8000-000000000001";
const invitationId = "30000000-0000-4000-8000-000000000001";
const email = "invitee@example.invalid";

function request() {
  return new Request(`http://127.0.0.1:3000/api/users/${userId}/retry-invitation`, {
    method: "POST",
  });
}

function setup(method: "invite" | "recovery" = "invite", accepted = true) {
  const operations: string[] = [];
  const rpc = vi.fn(async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { code: string } | null }> => {
    if (name === "bedos_prepare_staff_invitation_retry") {
      operations.push("prepare");
      expect(args).toEqual({ p_user_id: userId, p_actor_id: actorId });
      return {
        data: {
          invitation_id: invitationId,
          user_id: userId,
          email,
          method,
          attempt_number: 1,
        },
        error: null,
      };
    }
    if (name === "bedos_finish_staff_invitation_retry") {
      operations.push("finish");
      expect(args).toEqual({
        p_user_id: userId,
        p_actor_id: actorId,
        p_attempt_number: 1,
        p_accepted: accepted,
      });
      return { data: invitationId, error: null };
    }
    throw new Error("Unexpected RPC " + name);
  });
  const getUserById = vi.fn(async () => {
    operations.push("lookup");
    return {
      data: { user: { id: userId, email, email_confirmed_at: method === "recovery" ? "2026-10-28T12:00:00Z" : null } },
      error: null,
    };
  });
  const inviteUserByEmail = vi.fn(async (): Promise<{
    data: { user: { id: string; email: string } | null };
    error: { message: string } | null;
  }> => {
    operations.push("send-invite");
    return { data: { user: { id: userId, email } }, error: null };
  });
  const resetPasswordForEmail = vi.fn(async () => {
    operations.push("send-recovery");
    return { error: null };
  });
  mocks.adminClient.mockReturnValue({
    rpc,
    auth: {
      admin: { getUserById, inviteUserByEmail },
      resetPasswordForEmail,
    },
  });
  return { operations, rpc, getUserById, inviteUserByEmail, resetPasswordForEmail };
}

describe("staff invitation retry authorization and audit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("BEDOS_APP_ORIGIN", "");
    mocks.permission.mockResolvedValue({ user: { id: actorId } });
  });

  it("does not touch the admin client for unauthenticated requests", async () => {
    mocks.permission.mockRejectedValue(new ApiError("Unauthorized", 401));
    const response = await POST(request(), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(401);
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });

  it("sends a new invitation only after trusted preparation; audits the result", async () => {
    const { operations, inviteUserByEmail, resetPasswordForEmail } = setup("invite");
    const response = await POST(request(), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(202);
    expect(inviteUserByEmail).toHaveBeenCalledWith(email, {
      redirectTo: "http://127.0.0.1:3000/",
    });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(operations).toEqual(["prepare", "lookup", "send-invite", "finish"]);
  });

  it("uses password recovery only for confirmed invited users", async () => {
    const { operations, inviteUserByEmail, resetPasswordForEmail } = setup("recovery");
    const response = await POST(request(), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(202);
    expect(resetPasswordForEmail).toHaveBeenCalledWith(email, {
      redirectTo: "http://127.0.0.1:3000/auth/set-password",
    });
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(operations).toEqual(["prepare", "lookup", "send-recovery", "finish"]);
  });

  it("does not send an email if the DB refuses the pending invitation", async () => {
    const { rpc, inviteUserByEmail, resetPasswordForEmail } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023" } });
    const response = await POST(request(), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(409);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("maps cooldown to HTTP 429 without sending email", async () => {
    const { rpc, inviteUserByEmail } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001" } });
    const response = await POST(request(), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(429);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("records unsuccessful Auth email dispatch without granting access", async () => {
    const { operations, inviteUserByEmail, rpc } = setup("invite", false);
    inviteUserByEmail.mockImplementationOnce(async () => {
      operations.push("send-invite");
      return {
        data: { user: null },
        error: { message: "Synthetic provider failure" },
      };
    });
    const response = await POST(request(), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(502);
    expect(operations).toEqual(["prepare", "lookup", "send-invite", "finish"]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not send email for a changed Auth identity", async () => {
    const { operations, getUserById, inviteUserByEmail } = setup("invite", false);
    getUserById.mockImplementationOnce(async () => {
      operations.push("lookup");
      return {
        data: {
          user: {
            id: userId,
            email: "changed@example.invalid",
            email_confirmed_at: null,
          },
        },
        error: null,
      };
    });
    const response = await POST(request(), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(502);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(operations).toEqual(["prepare", "lookup", "finish"]);
  });

  it("returns HTTP 500 if a sent email cannot be audited", async () => {
    const { rpc, inviteUserByEmail } = setup();
    const original = rpc.getMockImplementation();
    rpc.mockImplementationOnce(async (name, args) => original!(name, args));
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23514" } });
    const response = await POST(request(), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(500);
    expect(inviteUserByEmail).toHaveBeenCalledOnce();
  });
});
