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

describe("staff invitation security", () => {
  it("rejects invitation when the staff profile is missing", async () => {
    const invitedId = "10000000-0000-4000-8000-000000000999";
    const deleteUser = vi.fn().mockResolvedValue({ error: null });

    const from = vi.fn((table: string) => {
      if (table === "roles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "test-role", name: "finance" },
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
                  error: { message: "No profile row found" },
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
          inviteUserByEmail: vi.fn().mockResolvedValue({
            data: { user: { id: invitedId } },
            error: null,
          }),
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
          full_name: "Test Finance Staff",
          role_id: "test-role",
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(deleteUser).toHaveBeenCalledWith(invitedId);
  });

  it("assigns the intended staff role successfully", async () => {
    const invitedId = "10000000-0000-4000-8000-000000000998";
    const roleId = "20000000-0000-4000-8000-000000000001";

    const deleteUser = vi.fn();
    const updateProfile = vi.fn();
    const updateEq = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({
          data: { id: invitedId },
          error: null,
        }),
      }),
    });

    updateProfile.mockReturnValue({ eq: updateEq });

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
      user: { id: "test-admin" },
    });

    mocks.adminClient.mockReturnValue({
      from,
      auth: {
        admin: {
          inviteUserByEmail: vi.fn().mockResolvedValue({
            data: { user: { id: invitedId } },
            error: null,
          }),
          deleteUser,
        },
      },
    });

    const response = await POST(
      new Request("http://localhost/api/users/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "finance@example.invalid",
          full_name: "Test Finance Staff",
          role_id: roleId,
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ role_id: roleId }),
    );
    expect(updateEq).toHaveBeenCalledWith("id", invitedId);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
