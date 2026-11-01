import { expect, it, vi } from "vitest";
import { POST } from "./route";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), permission: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/server/auth/require-permission", () => ({ requirePermission: mocks.permission }));
it("generates server-owned creation proof rather than trusting caller metadata", async () => {
  const actor = "10000000-0000-4000-8000-000000000001";
  const role = "20000000-0000-4000-8000-000000000001";
  const id = "30000000-0000-4000-8000-000000000001";
  const invitation = "40000000-0000-4000-8000-000000000001";
  const create = vi.fn().mockResolvedValue({ data: { user: { id } }, error: null });
  const rpc = vi.fn().mockResolvedValue({ data: invitation, error: null });
  mocks.permission.mockResolvedValue({ user: { id: actor } });
  mocks.admin.mockReturnValue({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: role, name: "finance" }, error: null }) }) }) }),
    rpc, auth: { admin: { createUser: create, inviteUserByEmail: vi.fn().mockResolvedValue({ data: { user: { id } }, error: null }) } },
  });
  const r = await POST(new Request("http://localhost/api/users/invite", { method: "POST", body: JSON.stringify({
    email: " Staff@Example.invalid ", full_name: " Staff Member ", phone: " 123 ", role_id: role,
    app_metadata: { bedos_staff_invitation: { requested_role_id: actor, created_by: id, request_id: "caller" } },
  }) }));
  expect(r.status).toBe(201);
  const attributes = create.mock.calls[0][0];
  expect(attributes.app_metadata.bedos_staff_invitation).toEqual({
    version: 1, request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    requested_role_id: role, created_by: actor, email: "staff@example.invalid", full_name: "Staff Member", phone: "123",
  });
  expect(attributes.user_metadata.bedos_staff_onboarding_pending).toBe(true);
  expect(rpc.mock.calls.map(call => call[0])).toEqual(["bedos_setup_staff_invitation", "bedos_record_staff_invitation_password_baseline"]);
});
