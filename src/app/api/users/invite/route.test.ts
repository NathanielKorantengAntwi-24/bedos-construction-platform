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
  it("rejects invitation without deleting the Auth account when the profile is missing", async () => {
    const invitedId = "10000000-0000-4000-8000-000000000999";
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const setup = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001" } });

    const from = vi.fn((table: string) => {
      if (table === "roles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "20000000-0000-4000-8000-000000000001", name: "finance" },
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
      rpc: setup,
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValue({
            data: { user: { id: invitedId } },
            error: null,
          }),
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
          role_id: "20000000-0000-4000-8000-000000000001",
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(setup).toHaveBeenCalledWith("bedos_setup_staff_invitation", {
      p_user_id: invitedId, p_actor_id: "test-admin", p_reason: "Initial staff invitation setup", p_resume: false,
    });
    expect(deleteUser).not.toHaveBeenCalled();
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
      user: { id: "test-admin" },
    });

    mocks.adminClient.mockReturnValue({
      from,
      rpc: authorizeInvitation,
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValue({
            data: { user: { id: invitedId } },
            error: null,
          }),
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
    expect(updateProfile).not.toHaveBeenCalled();
    expect(updateEq).not.toHaveBeenCalled();

    expect(authorizeInvitation).toHaveBeenCalledTimes(2);
    expect(authorizeInvitation).toHaveBeenNthCalledWith(
      1,
      "bedos_setup_staff_invitation",
      {
        p_user_id: invitedId,
        p_actor_id: "test-admin",
        p_reason: "Initial staff invitation setup", p_resume: false,
      },
    );

    expect(authorizeInvitation).toHaveBeenNthCalledWith(
      2,
      "bedos_record_staff_invitation_password_baseline",
      { p_user_id: invitedId },
    );

    expect(from).not.toHaveBeenCalledWith("staff_invitations");
    expect(from).not.toHaveBeenCalledWith("audit_logs");
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
