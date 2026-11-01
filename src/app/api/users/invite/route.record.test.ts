import { describe, expect, it, vi } from "vitest";

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

describe("Trusted staff invitation records", () => {
  it("authorizes the invitation atomically before sending email", async () => {
    const userId = "10000000-0000-4000-8000-000000000991";
    const roleId = "20000000-0000-4000-8000-000000000001";
    const adminId = "30000000-0000-4000-8000-000000000001";

    const operations: string[] = [];

    const createUser = vi.fn(async () => {
      operations.push("create-user");

      return {
        data: { user: { id: userId, email: "staff@example.invalid" } },
        error: null,
      };
    });

    const updateProfile = vi.fn(() => {
      operations.push("configure-profile");

      return {
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: { id: userId },
              error: null,
            }),
          }),
        }),
      };
    });

    const authorizeInvitation = vi.fn(async (functionName: string) => {
      if (functionName === "bedos_setup_staff_invitation") {
        operations.push("authorize-invitation");
      } else if (
        functionName === "bedos_record_staff_invitation_password_baseline"
      ) {
        operations.push("record-password-baseline");
      } else {
        throw new Error("Unexpected RPC: " + functionName);
      }
      return {
        data: "40000000-0000-4000-8000-000000000001",
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
      user: { id: adminId },
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

    const response = await POST(
      new Request("http://localhost/api/users/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "staff@example.invalid",
          full_name: "Finance Staff",
          role_id: roleId,
        }),
      }),
    );

    expect(response.status).toBe(201);

    expect(authorizeInvitation).toHaveBeenCalledTimes(2);
    expect(authorizeInvitation).toHaveBeenNthCalledWith(
      1,
      "bedos_setup_staff_invitation",
      {
        p_user_id: userId,
        p_actor_id: adminId,
        p_reason: "Initial staff invitation setup", p_resume: false,
      },
    );

    expect(authorizeInvitation).toHaveBeenNthCalledWith(
      2,
      "bedos_record_staff_invitation_password_baseline",
      { p_user_id: userId },
    );

    expect(operations).toEqual([
      "create-user",
      "authorize-invitation",
      "send-invitation",
      "record-password-baseline",
    ]);
  });
});
