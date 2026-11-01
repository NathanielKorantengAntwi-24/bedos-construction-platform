import { beforeEach, expect, it, vi } from "vitest";
import { requirePermission } from "./require-permission";

const mocks = vi.hoisted(() => ({ client: vi.fn(), authUser: vi.fn(), profile: vi.fn(), permissions: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
const roles = {
  content: { id: "11111111-1111-4111-8111-111111111111", name: "content_manager" },
  finance: { id: "22222222-2222-4222-8222-222222222222", name: "finance" },
};
let current = roles.content;
beforeEach(() => {
  vi.clearAllMocks();
  current = roles.content;
  // Same authenticated provider user throughout; no sign-in/token refresh.
  mocks.authUser.mockResolvedValue({ data: { user: { id: "staff-id" } }, error: null });
  mocks.profile.mockImplementation(async () => ({ data: { id: "staff-id", account_status: "active", role_id: current.id, roles: current }, error: null }));
  mocks.permissions.mockImplementation(async (key: string, id: string) => ({
    data: key === "role_id" ? [{ permissions: { name: id === roles.content.id ? "services.manage" : "payments.manage" } }] : [], error: null,
  }));
  mocks.client.mockResolvedValue({
    auth: { getUser: mocks.authUser },
    from: (table: string) => table === "profiles"
      ? { select: () => ({ eq: () => ({ single: mocks.profile }) }) }
      : { select: () => ({ eq: mocks.permissions }) },
  });
});

it("rechecks database role and permissions on every request after role changes", async () => {
  await expect(requirePermission("services.manage")).resolves.toMatchObject({ role: roles.content });
  current = roles.finance;
  await expect(requirePermission("services.manage")).rejects.toMatchObject({ status: 403 });
  await expect(requirePermission("payments.manage")).resolves.toMatchObject({ role: roles.finance });
  current = roles.content;
  await expect(requirePermission("payments.manage")).rejects.toMatchObject({ status: 403 });
  await expect(requirePermission("services.manage")).resolves.toMatchObject({ role: roles.content });
  expect(mocks.profile).toHaveBeenCalledTimes(5);
  expect(mocks.permissions.mock.calls.map(call => call[1])).toEqual([
    roles.content.id, roles.finance.id, roles.finance.id, roles.content.id, roles.content.id,
  ]);
});
