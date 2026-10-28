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

describe("Staff invitation identity protection", () => {
  it("rejects mismatched Auth IDs without changing the invited user's profile", async () => {
    const createdId = "10000000-0000-4000-8000-000000000991";
    const invitedId = "10000000-0000-4000-8000-000000000992";

    const createUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: createdId,
          email: "staff@example.invalid",
        },
      },
      error: null,
    });

    const inviteUserByEmail = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: invitedId,
          email: "staff@example.invalid",
        },
      },
      error: null,
    });

    const targetProfile = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({
          data: { id: createdId },
          error: null,
        }),
      }),
    });

    const updateProfile = vi.fn().mockReturnValue({
      eq: targetProfile,
    });

    const authorizeInvitation = vi.fn().mockResolvedValue({
      data: "40000000-0000-4000-8000-000000000001",
      error: null,
    });

    const from = vi.fn((table: string) => {
      if (table === "roles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "finance-role",
                  name: "finance",
                },
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

    const response = await POST(
      new Request("http://localhost/api/users/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "staff@example.invalid",
          full_name: "Test Staff",
          role_id: "finance-role",
        }),
      }),
    );

    expect(createUser).toHaveBeenCalledOnce();

    expect(authorizeInvitation).toHaveBeenCalledOnce();
    expect(authorizeInvitation).toHaveBeenCalledWith(
      "bedos_authorize_staff_invitation",
      {
        p_user_id: createdId,
        p_invited_by: "administrator-id",
        p_approved_role_id: "finance-role",
      },
    );

    expect(from).not.toHaveBeenCalledWith("staff_invitations");
    expect(from).not.toHaveBeenCalledWith("audit_logs");

    expect(inviteUserByEmail).toHaveBeenCalledOnce();

    // Configure only the newly created Auth user's profile.
    expect(updateProfile).toHaveBeenCalledOnce();
    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        role_id: "finance-role",
        account_status: "inactive",
      }),
    );

    expect(targetProfile).toHaveBeenCalledOnce();
    expect(targetProfile).toHaveBeenCalledWith("id", createdId);
    expect(targetProfile).not.toHaveBeenCalledWith("id", invitedId);
    expect(response.status).toBe(500);
  });
});
