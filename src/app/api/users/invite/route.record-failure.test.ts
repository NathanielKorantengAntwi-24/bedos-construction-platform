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

describe("Staff invitation record failure protection", () => {
  it("never sends an invitation when the trusted record cannot be saved", async () => {
    const userId = "10000000-0000-4000-8000-000000000992";
    const roleId = "20000000-0000-4000-8000-000000000001";
    const adminId = "30000000-0000-4000-8000-000000000001";

    const updateProfile = vi.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: { id: userId },
            error: null,
          }),
        }),
      }),
    });

    const authorizeInvitation = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        message: "Simulated atomic authorization failure",
      },
    });

    const inviteUserByEmail = vi.fn();
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
          createUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: userId,
                email: "staff@example.invalid",
              },
            },
            error: null,
          }),
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

    expect(updateProfile).not.toHaveBeenCalled();

    expect(authorizeInvitation).toHaveBeenCalledOnce();
    expect(authorizeInvitation).toHaveBeenCalledWith(
      "bedos_setup_staff_invitation",
      {
        p_user_id: userId,
        p_actor_id: adminId,
        p_reason: "Initial staff invitation setup", p_resume: false,
      },
    );

    expect(from).not.toHaveBeenCalledWith("staff_invitations");
    expect(from).not.toHaveBeenCalledWith("audit_logs");
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
