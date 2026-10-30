import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as list } from "./route";
import { GET as detail } from "./[id]/route";
import { ApiError } from "@/server/http/api-error";
import { parseUserListQuery } from "@/features/users/user.service";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock("@/server/auth/require-permission", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const actor = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const getList = (query = "") => list(new Request(`http://localhost/api/users${query}`));
const getDetail = (value = id, query = "") => detail(new Request(`http://localhost/api/users/${value}${query}`), { params: Promise.resolve({ id: value }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ user: { id: actor } });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { users: [], total: 0, page: 1, limit: 25 }, error: null });
});

describe("administrator user reads", () => {
  for (const [name, call] of [["list", getList], ["detail", getDetail]] as const) {
    for (const status of [401, 403]) {
      it(`${name} denies ${status} before validation or privileged work`, async () => {
        mocks.permission.mockRejectedValue(new ApiError("Denied", status));
        const res = await call("invalid");
        expect(res.status).toBe(status);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(mocks.permission).toHaveBeenCalledWith("users.view");
        expect(mocks.admin).not.toHaveBeenCalled();
      });
    }
  }
  it("passes defaults and verified actor to SQL", async () => {
    const res = await getList();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ users: [], total: 0, page: 1, limit: 25 });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_read_users", { p_actor_id: actor, p_page: 1, p_limit: 25, p_role: null, p_account_status: null, p_q: null });
  });
  it("passes combined filters as bound parameters, including literal metacharacters", async () => {
    const q = "  A_%\\,+()  ";
    const res = await getList(`?page=2&limit=100&role=customer&account_status=suspended&q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_read_users", { p_actor_id: actor, p_page: 2, p_limit: 100, p_role: "customer", p_account_status: "suspended", p_q: q.trim() });
  });
  for (const query of ["?limit=101", "?limit=0", "?page=-1", "?page=1.2", "?page=1e2", "?page=2147483648", "?page=01", "?page=", "?role=owner", "?role=", "?account_status=pending", "?q=" + "x".repeat(101), "?q=%00", "?sort=email", "?q=a&q=b", "?page=1&page=2"]) {
    it(`rejects invalid query ${query.slice(0, 40)}`, async () => {
      expect((await getList(query)).status).toBe(400);
      expect(mocks.admin).not.toHaveBeenCalled();
    });
  }
  it("normalizes blank search without changing default pagination", () => {
    expect(parseUserListQuery(new URLSearchParams("q=%20%20"))).toEqual({ page: 1, limit: 25, role: null, accountStatus: null, q: null });
  });
  it("returns safe detail returned by SQL, including nullable invitation", async () => {
    const user = { id, email: "local@example.invalid", invitation: null };
    mocks.rpc.mockResolvedValue({ data: user, error: null });
    const res = await getDetail();
    expect(await res.json()).toEqual({ user });
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_read_users", { p_actor_id: actor, p_user_id: id });
  });
  it("rejects malformed detail UUID and unexpected query without privileged work", async () => {
    expect((await getDetail("bad")).status).toBe(400);
    expect((await getDetail(id, "?include=secrets")).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("maps absent detail to 404", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await getDetail()).status).toBe(404);
  });
  for (const [code, status] of [["42501", 403], ["22023", 400], ["XX000", 500]] as const) {
    it(`maps database ${code} safely`, async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private provider details" } });
      const res = await getList();
      expect(res.status).toBe(status);
      expect(await res.text()).not.toContain("private provider details");
    });
  }
  it("does not treat missing list data as success", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await getList()).status).toBe(500);
  });
});
