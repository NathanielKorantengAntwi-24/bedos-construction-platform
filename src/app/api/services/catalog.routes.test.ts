import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as services, POST as createService } from "./route";
import { GET as service, PATCH as updateService, DELETE as deleteService } from "./[id]/route";
import { GET as categories, POST as createCategory } from "../service-categories/route";
import { GET as category, PATCH as updateCategory, DELETE as deleteCategory } from "../service-categories/[id]/route";
import { GET as publicServices } from "../public/services/route";
import { GET as publicService } from "../public/services/[slug]/route";
import { GET as publicCategories } from "../public/service-categories/route";
import { ApiError } from "@/server/http/api-error";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock("@/server/auth/require-permission", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const actor = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
type Options = { id?: string; query?: string; body?: string };
const request = (method: string, options: Options = {}) => new Request("http://localhost/api/catalog" + (options.query || ""), { method, ...(method === "POST" || method === "PATCH" ? { body: options.body ?? '{"name":"Name","slug":"Slug"}', headers: { "Content-Type": "application/json" } } : {}) });
const context = (options: Options = {}) => ({ params: Promise.resolve({ id: options.id ?? id }) });
const protectedRoutes = [
  { name: "service list", permission: "services.view", call: (o: Options = {}) => services(request("GET", o)) },
  { name: "category list", permission: "services.view", call: (o: Options = {}) => categories(request("GET", o)) },
  { name: "service detail", permission: "services.view", call: (o: Options = {}) => service(request("GET", o), context(o)) },
  { name: "category detail", permission: "services.view", call: (o: Options = {}) => category(request("GET", o), context(o)) },
  { name: "service create", permission: "services.manage", call: (o: Options = {}) => createService(request("POST", o)) },
  { name: "category create", permission: "services.manage", call: (o: Options = {}) => createCategory(request("POST", o)) },
  { name: "service update", permission: "services.manage", call: (o: Options = {}) => updateService(request("PATCH", o), context(o)) },
  { name: "category update", permission: "services.manage", call: (o: Options = {}) => updateCategory(request("PATCH", o), context(o)) },
  { name: "service delete", permission: "services.manage", call: (o: Options = {}) => deleteService(request("DELETE", o), context(o)) },
  { name: "category delete", permission: "services.manage", call: (o: Options = {}) => deleteCategory(request("DELETE", o), context(o)) },
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ user: { id: actor } });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { id, name: "Name", slug: "Slug" }, error: null });
});
describe("protected catalog routes", () => {
  for (const route of protectedRoutes) {
    for (const status of [401, 403]) it(`${route.name} denies ${status} before validation and privileged work`, async () => {
      mocks.permission.mockRejectedValue(new ApiError("Denied", status));
      const r = await route.call({ id: "bad", query: "?bad=1", body: "{" });
      expect(r.status).toBe(status); expect(r.headers.get("cache-control")).toBe("no-store");
      expect(mocks.permission).toHaveBeenCalledWith(route.permission); expect(mocks.admin).not.toHaveBeenCalled();
    });
    it(`${route.name} supplies a verified actor`, async () => {
      const r = await route.call(); expect(r.status).toBe(route.name.includes("create") ? 201 : 200);
      expect(mocks.rpc.mock.calls[0][1].p_actor_id).toBe(actor);
      expect(r.headers.get("cache-control")).toBe("no-store");
    });
  }
  for (const route of protectedRoutes.filter(r => /create|update/.test(r.name))) {
    for (const body of ["{", "null", "[]", "7", '{"name":7,"slug":"s"}', '{"name":"n","slug":"s","created_by":"forged"}', '{"name":"n","slug":"s","description":false}']) {
      it(`${route.name} rejects invalid JSON/input ${body}`, async () => {
        expect((await route.call({ body })).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
      });
    }
  }
  for (const route of protectedRoutes.filter(r => /detail|update|delete/.test(r.name))) {
    it(`${route.name} rejects invalid UUID`, async () => { expect((await route.call({ id: "bad" })).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it(`${route.name} rejects unexpected query keys`, async () => { expect((await route.call({ query: "?status=draft" })).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
  }
  it("binds filters and literal search with bounded defaults", async () => {
    await services(request("GET", { query: "?q=%25_%2C%2B()%5C&status=draft&featured=false" }));
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_read_service_catalog", expect.objectContaining({ p_actor_id: actor, p_public: false, p_page: 1, p_page_size: 25, p_q: "%_,+()\\", p_status: "draft", p_featured: false }));
  });
  for (const [code, status] of [["42501", 403], ["22023", 400], ["P0002", 404], ["23505", 409], ["23503", 409], ["XX000", 500]] as const) {
    it(`maps SQL ${code} safely`, async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private database diagnostic" } });
      const r = await createService(request("POST")); expect(r.status).toBe(status);
      expect(JSON.stringify(await r.json())).not.toContain("private database");
    });
  }
  it("does not classify provider transport errors as missing records", async () => {
    mocks.rpc.mockRejectedValue(new Error("private transport diagnostic"));
    const r = await service(request("GET"), context()); expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("private transport");
  });
  it("deletes through one atomic RPC without a preliminary read", async () => {
    await deleteCategory(request("DELETE"), context());
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_mutate_service_category", { p_actor_id: actor, p_action: "delete", p_id: id, p_input: {} });
  });
});
describe("public catalog route boundary", () => {
  const routes = [
    { name: "services", call: (query = "") => publicServices(request("GET", { query })) },
    { name: "categories", call: (query = "") => publicCategories(request("GET", { query })) },
    { name: "service slug", call: (query = "") => publicService(request("GET", { query }), { params: Promise.resolve({ slug: "Mixed-Slug" }) }) },
  ];
  for (const route of routes) {
    it(`${route.name} requires the fixed public projection path and no authenticated actor`, async () => {
      const r = await route.call(); expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("no-store");
      expect(mocks.permission).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledWith("bedos_read_service_catalog", expect.objectContaining({ p_public: true, p_actor_id: null, p_status: null }));
    });
    it(`${route.name} cannot request drafts or extra fields`, async () => {
      expect((await route.call("?status=draft")).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
    });
  }
  it("public missing slug maps to 404", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    expect((await routes[2].call()).status).toBe(404);
    expect(mocks.rpc.mock.calls[0][1].p_slug).toBe("Mixed-Slug");
  });
});
