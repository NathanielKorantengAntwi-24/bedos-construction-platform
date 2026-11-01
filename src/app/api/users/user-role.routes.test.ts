import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./[id]/role/route";
import { ApiError } from "@/server/http/api-error";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock("@/server/auth/require-permission", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const actor = "11111111-1111-4111-8111-111111111111";
const id = "abcdef12-2222-4222-8222-222222222222";
const roleId = "abcdef34-3333-4333-8333-333333333333";
const previousRoleId = "abcdef56-4444-4444-8444-444444444444";
const valid = { role_id: roleId, expected_role_id: previousRoleId, reason: "  Role review  " };
function request(body: unknown = valid, target = id, query = "", raw = false) {
  return PATCH(new Request(`http://localhost/api/users/${target}/role${query}`, { method: "PATCH", body: raw ? String(body) : JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: target }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ user: { id: actor } });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { user_id: id, role: { id: roleId, name: "finance" } }, error: null });
});
describe("ordinary staff role changes", () => {
  for (const status of [401, 403]) {
    it(`requires users.manage before target or body handling (${status})`, async () => {
      mocks.permission.mockRejectedValue(new ApiError("Denied", status));
      expect((await request("{", "bad", "", true)).status).toBe(status);
      expect(mocks.permission).toHaveBeenCalledWith("users.manage");
      expect(mocks.admin).not.toHaveBeenCalled();
    });
  }
  it("binds verified actor, canonical IDs and trimmed audit reason", async () => {
    const r = await request({ ...valid, role_id: roleId.toUpperCase(), expected_role_id: previousRoleId.toUpperCase() }, id.toUpperCase());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_update_user_role", { p_actor_id: actor, p_user_id: id, p_role_id: roleId, p_expected_role_id: previousRoleId, p_reason: "Role review" });
    expect(await r.json()).toEqual({ user_id: id, role: { id: roleId, name: "finance" } });
  });
  it("returns only approved output fields", async () => {
    mocks.rpc.mockResolvedValue({ data: { user_id: id, private_data: "hidden", role: { id: roleId, name: "content_manager", internal: "hidden" } }, error: null });
    expect(await (await request()).json()).toEqual({ user_id: id, role: { id: roleId, name: "content_manager" } });
  });
  it("rejects malformed JSON", async () => {
    expect((await request("{", id, "", true)).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  for (const body of [null, [], "body", {}, { ...valid, actor_id: actor }, { ...valid, account_status: "active" }, { ...valid, role_id: "finance" }, { ...valid, role_id: null }, { ...valid, expected_role_id: 12 }, { ...valid, expected_role_id: "" }, { ...valid, reason: null }, { ...valid, reason: "\t\n" }, { ...valid, reason: "x".repeat(501) }, { ...valid, reason: "a\0b" }]) {
    it(`rejects invalid/unknown input ${JSON.stringify(body).slice(0, 80)}`, async () => {
      const r = await request(body);
      expect(r.status).toBe(400);
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.admin).not.toHaveBeenCalled();
    });
  }
  it("rejects unsupported query and invalid target", async () => {
    expect((await request(valid, id, "?force=true")).status).toBe(400);
    expect((await request(valid, "bad")).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  for (const [code, status] of [["42501", 403], ["22023", 400], ["P0002", 404], ["P0001", 409], ["23514", 500], ["XX000", 500]] as const) {
    it(`maps SQL ${code} to ${status} with no provider or reason disclosure`, async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private reason or SQL details" } });
      const r = await request();
      expect(r.status).toBe(status);
      expect(await r.text()).not.toContain("private reason");
    });
  }
  for (const data of [null, {}, { user_id: actor, role: { id: roleId, name: "finance" } }, { user_id: id, role: { id: previousRoleId, name: "finance" } }, { user_id: id, role: { id: roleId, name: "administrator" } }]) {
    it("rejects inconsistent or privileged success output", async () => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect((await request()).status).toBe(500);
    });
  }
});
