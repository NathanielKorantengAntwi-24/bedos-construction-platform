import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./[id]/status/route";
import { ApiError } from "@/server/http/api-error";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock("@/server/auth/require-permission", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const actor = "11111111-1111-4111-8111-111111111111";
const id = "abcdef12-2222-4222-8222-222222222222";
const valid = { account_status: "suspended", expected_account_status: "active", reason: "  Requested review  " };
function request(body: unknown = valid, target = id, query = "", raw = false) {
  return PATCH(new Request(`http://localhost/api/users/${target}/status${query}`, { method: "PATCH", body: raw ? String(body) : JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: target }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ user: { id: actor } });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { user_id: id, account_status: "suspended" }, error: null });
});
describe("account suspension/restoration", () => {
  for (const status of [401, 403]) {
    it(`requires users.manage before body or target processing (${status})`, async () => {
      mocks.permission.mockRejectedValue(new ApiError("Denied", status));
      const r = await request("{", "invalid", "", true);
      expect(r.status).toBe(status);
      expect(mocks.permission).toHaveBeenCalledWith("users.manage");
      expect(mocks.admin).not.toHaveBeenCalled();
    });
  }
  it("binds trusted actor, normalized target, expected state and trimmed audit reason", async () => {
    const r = await request(valid, id.toUpperCase());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_update_user_status", { p_actor_id: actor, p_user_id: id, p_account_status: "suspended", p_expected_account_status: "active", p_reason: "Requested review" });
    expect(await r.json()).toEqual({ user_id: id, account_status: "suspended" });
  });
  it("supports restoration and returns only approved fields", async () => {
    mocks.rpc.mockResolvedValue({ data: { user_id: id, account_status: "active", private_data: "hidden" }, error: null });
    const r = await request({ account_status: "active", expected_account_status: "suspended", reason: "Approved restoration" });
    expect(await r.json()).toEqual({ user_id: id, account_status: "active" });
  });
  it("rejects malformed JSON", async () => {
    expect((await request("{", id, "", true)).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  for (const body of [null, [], "body", 12, {}, { ...valid, actor_id: actor }, { ...valid, role_id: id }, { ...valid, account_status: "inactive" }, { ...valid, account_status: null }, { ...valid, expected_account_status: "pending" }, { ...valid, reason: null }, { ...valid, reason: "\t\n " }, { ...valid, reason: "x".repeat(501) }, { ...valid, reason: "a\0b" }]) {
    it(`rejects invalid/unknown fields: ${JSON.stringify(body).slice(0, 85)}`, async () => {
      const r = await request(body);
      expect(r.status).toBe(400);
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.admin).not.toHaveBeenCalled();
    });
  }
  it("rejects invalid UUID and unsupported query keys", async () => {
    expect((await request(valid, "bad")).status).toBe(400);
    expect((await request(valid, id, "?force=true")).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("passes inactive expected state to SQL for lifecycle conflict classification", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001" } });
    expect((await request({ ...valid, account_status: "active", expected_account_status: "inactive" })).status).toBe(409);
  });
  for (const [code, status] of [["42501", 403], ["22023", 400], ["P0002", 404], ["P0001", 409], ["23514", 500], ["XX000", 500]] as const) {
    it(`maps database ${code} to ${status} without exposing audit/provider details`, async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private audit reason or provider text" } });
      const r = await request();
      expect(r.status).toBe(status);
      expect(await r.text()).not.toContain("private audit");
    });
  }
  for (const data of [null, {}, { user_id: actor, account_status: "suspended" }, { user_id: id, account_status: "active" }]) {
    it("rejects inconsistent database success output", async () => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect((await request()).status).toBe(500);
    });
  }
});
