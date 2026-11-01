import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminClient: vi.fn(),
  permission: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.adminClient,
}));

vi.mock("@/server/auth/require-permission", () => ({
  requirePermission: mocks.permission,
}));

import { POST } from "./route";

const userId = "10000000-0000-4000-8000-000000000990";
const roleId = "20000000-0000-4000-8000-000000000001";

function setup(profileFails: boolean) {
  const operations: string[] = [];

  const createUser = vi.fn(async () => {
    operations.push("create-user");

    return {
      data: { user: { id: userId, email: "staff@example.invalid" } },
      error: null,
    };
  });

  const inviteUserByEmail = vi.fn(async () => {
    operations.push("send-invitation");

    return {
      data: { user: { id: userId, email: "staff@example.invalid" } },
      error: null,
    };
  });

  const updateProfile = vi.fn((changes: Record<string, unknown>) => {
    operations.push("configure-profile");

    expect(changes).toEqual(
      expect.objectContaining({
        role_id: roleId,
        account_status: "inactive",
      }),
    );

    return {
      eq: (column: string, value: string) => {
        expect(column).toBe("id");
        expect(value).toBe(userId);

        return {
          select: () => ({
            single: async () => ({
              data: profileFails ? null : { id: userId },
              error: profileFails
                ? { message: "Profile configuration failed" }
                : null,
            }),
          }),
        };
      },
    };
  });

  const authorizeInvitation = vi.fn(
    async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "bedos_setup_staff_invitation") {
        operations.push("authorize-invitation");

        expect(args).toEqual({
          p_user_id: userId,
          p_actor_id: "administrator-id",
          p_reason: "Initial staff invitation setup", p_resume: false,
        });
        if (profileFails) return { data: null, error: { code: "P0001" } };
      } else if (
        functionName === "bedos_record_staff_invitation_password_baseline"
      ) {
        operations.push("record-password-baseline");

        expect(args).toEqual({
          p_user_id: userId,
        });
      } else {
        throw new Error("Unexpected RPC: " + functionName);
      }

      return {
        data: "40000000-0000-4000-8000-000000000001",
        error: null,
      };
    },
  );

  const from = vi.fn((table: string) => {
    if (table === "roles") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: roleId, name: "finance" },
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === "profiles") {
      return { update: updateProfile };
    }

    throw new Error("Unexpected table: " + table);
  });

  mocks.permission.mockResolvedValue({
    user: { id: "administrator-id" },
  });

  mocks.adminClient.mockReturnValue({
    from,
    rpc: authorizeInvitation,
    auth: {
      admin: {
        createUser,
        inviteUserByEmail,
      },
    },
  });

  return { operations, createUser, updateProfile, inviteUserByEmail, authorizeInvitation };
}

function request() {
  return new Request("http://localhost/api/users/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "staff@example.invalid",
      full_name: "Finance Staff",
      role_id: roleId,
    }),
  });
}

describe("Staff invitation operation ordering", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("configures the inactive profile before sending an invitation", async () => {
    const { operations, createUser, authorizeInvitation } = setup(false);

    const response = await POST(request());

    expect(response.status).toBe(201);

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "staff@example.invalid",
        user_metadata: expect.objectContaining({
          bedos_staff_onboarding_pending: true,
        }),
      }),
    );
    expect(authorizeInvitation).toHaveBeenCalledTimes(2);

    expect(operations).toEqual([
      "create-user",
      "authorize-invitation",
      "send-invitation",
      "record-password-baseline",
    ]);
  });

  it("does not send an invitation if profile configuration fails", async () => {
    const { updateProfile, inviteUserByEmail, authorizeInvitation } =
      setup(true);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(authorizeInvitation).toHaveBeenCalledOnce();
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });
});
