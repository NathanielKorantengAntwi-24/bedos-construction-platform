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

describe("Existing-account role protection", () => {
  it("does not reassign an existing unconfirmed customer", async () => {
    const existingId = "10000000-0000-4000-8000-000000000996";
    const roleId = "20000000-0000-4000-8000-000000000001";

    const updateProfile = vi.fn(() => ({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: { id: existingId },
            error: null,
          }),
        }),
      }),
    }));

    const createUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: {
        code: "email_exists",
        message: "User already registered",
      },
    });

    const inviteUserByEmail = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: existingId,
          email: "existing-customer@example.invalid",
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
          email: "existing-customer@example.invalid",
          full_name: "Existing Customer",
          role_id: roleId,
        }),
      }),
    );

    // Existing customers must never be silently reassigned.
    expect(createUser).toHaveBeenCalledOnce();
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
  });
});
