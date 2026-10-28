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

describe("Staff creation duplicate-account protection", () => {
  it("rejects existing email before inviting or changing a profile", async () => {
    const createUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: {
        code: "email_exists",
        message: "User already registered",
        status: 422,
      },
    });

    const inviteUserByEmail = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "existing-user",
          email: "existing@example.invalid",
        },
      },
      error: null,
    });

    const updateProfile = vi.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: { id: "existing-user" },
            error: null,
          }),
        }),
      }),
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

      if (table === "audit_logs") {
        return {
          insert: async () => ({ error: null }),
        };
      }

      throw new Error("Unexpected table: " + table);
    });

    mocks.permission.mockResolvedValue({
      user: { id: "administrator-id" },
    });

    mocks.adminClient.mockReturnValue({
      from,
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
          email: "existing@example.invalid",
          full_name: "Existing Customer",
          role_id: "finance-role",
        }),
      }),
    );

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "existing@example.invalid",
      }),
    );

    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
  });
});
