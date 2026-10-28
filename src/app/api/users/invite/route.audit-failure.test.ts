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

describe("Staff invitation audit failure protection", () => {
  it("does not dispatch email when atomic authorization reports audit failure", async () => {
    const userId = "10000000-0000-4000-8000-000000000994";
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

    const authorizeInvitation = vi.fn(async () => {
      operations.push("authorize-invitation");

      return {
        data: null,
        error: {
          code: "23514",
          message: "Simulated audit insertion failure inside atomic RPC",
        },
      };
    });

    const inviteUserByEmail = vi.fn(async () => {
      operations.push("send-invitation");
      return {
        data: { user: { id: userId } },
        error: null,
      };
    });

    const deleteUser = vi.fn();

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
          deleteUser,
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

    expect(response.status).toBe(500);

    expect(authorizeInvitation).toHaveBeenCalledOnce();
    expect(authorizeInvitation).toHaveBeenCalledWith(
      "bedos_authorize_staff_invitation",
      {
        p_user_id: userId,
        p_invited_by: adminId,
        p_approved_role_id: roleId,
      },
    );

    expect(from).not.toHaveBeenCalledWith("staff_invitations");
    expect(from).not.toHaveBeenCalledWith("audit_logs");
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();

    expect(operations).toEqual([
      "create-user",
      "configure-profile",
      "authorize-invitation",
    ]);
  });
});
