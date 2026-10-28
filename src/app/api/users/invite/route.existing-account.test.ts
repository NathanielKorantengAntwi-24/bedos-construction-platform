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

describe("Staff invitation configuration failure", () => {
  it("preserves the newly created Auth account when profile configuration fails", async () => {
    const createdUserId =
      "10000000-0000-4000-8000-000000000997";

    const deleteUser = vi.fn();

    const createUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: createdUserId,
          email: "staff@example.invalid",
        },
      },
      error: null,
    });

    const inviteUserByEmail = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: createdUserId,
          email: "staff@example.invalid",
          created_at: "2026-10-01T00:00:00Z",
          invited_at: "2026-10-24T00:00:00Z",
          email_confirmed_at: null,
        },
      },
      error: null,
    });

    const from = vi.fn((table: string) => {
      if (table === "roles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "test-role",
                  name: "finance",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "profiles") {
        return {
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: {
                    message: "Profile update failed",
                  },
                }),
              }),
            }),
          }),
        };
      }

      throw new Error("Unexpected table: " + table);
    });

    mocks.permission.mockResolvedValue({
      user: { id: "test-admin" },
    });

    mocks.adminClient.mockReturnValue({
      from,
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
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "staff@example.invalid",
          full_name: "Existing Staff",
          role_id: "test-role",
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(createUser).toHaveBeenCalledOnce();

    expect(inviteUserByEmail).not.toHaveBeenCalled();

    // Never delete an existing account on invitation failure.
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
