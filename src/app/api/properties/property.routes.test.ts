import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as list, POST as create } from "./route";
import { GET as detail, PATCH as edit, DELETE as remove } from "./[id]/route";
import { GET as manage } from "./manage/route";
import { PATCH as status } from "./[id]/status/route";
import { ApiError } from "@/server/http/api-error";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), context: vi.fn(), rpc: vi.fn(), admin: vi.fn() }));
vi.mock("@/server/auth/require-permission", () => ({ requirePermission: mocks.permission }));
vi.mock("@/server/auth/get-user-context", () => ({ getUserContext: mocks.context }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const actor = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const ctx = (value = id) => ({ params: Promise.resolve({ id: value }) });
const req = (method: string, body?: unknown, query = "") => new Request("http://localhost/api/properties" + query, { method, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ user: { id: actor } });
  mocks.context.mockResolvedValue(null);
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { id, title: "House" }, error: null });
});
const protectedRoutes = [
  { name: "create", call: () => create(req("POST", { title: "House", slug: "house", property_type: "house", listing_type: "sale" })) },
  { name: "edit", call: () => edit(req("PATCH", { price: 10 }), ctx()) },
  { name: "status", call: () => status(req("PATCH", { status: "published", expected_status: "draft", reason: "Reviewed" }), ctx()) },
  { name: "delete", call: () => remove(req("DELETE"), ctx()) },
  { name: "manage", call: () => manage(req("GET")) },
];
describe("property authorization and transport", () => {
  for (const route of protectedRoutes) {
    for (const code of [401, 403]) it(`${route.name} rejects ${code} before privileged work`, async () => {
      mocks.permission.mockRejectedValue(new ApiError("Denied", code));
      const r = await route.call();
      expect(r.status).toBe(code); expect(r.headers.get("cache-control")).toBe("no-store");
      expect(mocks.admin).not.toHaveBeenCalled();
    });
    it(`${route.name} supplies verified actor`, async () => {
      const r = await route.call();
      expect(r.status).toBe(route.name === "create" ? 201 : 200);
      expect(mocks.permission).toHaveBeenCalledWith("properties.manage");
      expect(mocks.rpc.mock.calls[0][1].p_actor_id).toBe(actor);
    });
  }
  it("public collection never forwards an authenticated actor", async () => {
    const r = await list(req("GET", undefined, "?search=%25%2C%28x%29&min_price=1"));
    expect(r.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_read_properties", expect.objectContaining({ p_actor_id: null, p_filters: expect.objectContaining({ search: "%,(x)", min_price: 1 }) }));
    expect(mocks.permission).not.toHaveBeenCalled();
  });
  it.each([null, { user: { id: actor }, profile: { account_status: "active" }, role: { name: "customer" } }, { user: { id: actor }, profile: { account_status: "suspended" }, role: { name: "administrator" } }])("uses public detail projection without active staff preview", async user => {
    mocks.context.mockResolvedValue(user);
    expect((await detail(req("GET"), ctx())).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_actor_id).toBeNull();
  });
  it("passes active content manager for database-rechecked preview", async () => {
    mocks.context.mockResolvedValue({ user: { id: actor }, profile: { account_status: "active" }, role: { name: "content_manager" } });
    expect((await detail(req("GET"), ctx())).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_actor_id).toBe(actor);
  });
  it("rejects malformed JSON, unknown fields, invalid IDs and lifecycle bypass", async () => {
    expect((await create(req("POST", "{"))).status).toBe(400);
    expect((await edit(req("PATCH", { status: "sold" }), ctx())).status).toBe(400);
    expect((await remove(req("DELETE"), ctx("bad"))).status).toBe(400);
    expect((await detail(req("GET", undefined, "?unknown=1"), ctx())).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["22023", 400], ["P0002", 404], ["P0001", 409], ["23503", 409], ["23505", 409]])("maps provider %s safely", async (code, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private database detail" } });
    const r = await remove(req("DELETE"), ctx());
    expect(r.status).toBe(expected);expect(await r.text()).not.toContain("private database detail");
  });
});
