import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as list } from "./route";
import { GET as collection, POST as create } from "../properties/[id]/viewing-requests/route";
import { GET as detail, PATCH as update, DELETE as remove } from "../properties/[id]/viewing-requests/[viewingRequestId]/route";
import { GET as events } from "./notification-events/route";
import { POST as retry } from "./notification-events/[eventId]/retry/route";
import { ApiError } from "@/server/http/api-error";
const mocks = vi.hoisted(() => ({ context: vi.fn(), permission: vi.fn(), rpc: vi.fn(), admin: vi.fn() }));
vi.mock("@/server/auth/get-user-context", () => ({ getUserContext: mocks.context }));
vi.mock("@/server/auth/require-permission", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const actor = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ id, viewingRequestId: id }) }, eventContext = { params: Promise.resolve({ eventId: id }) };
const request = (method = "GET", body?: string, query = "") => new Request("http://localhost/api/viewing-requests" + query, { method, ...(body === undefined ? {} : { body }) });
const user = (role = "customer", status = "active") => ({ user: { id: actor }, profile: { account_status: status }, role: { name: role } });
beforeEach(() => {
  vi.resetAllMocks(); mocks.admin.mockReturnValue({ rpc: mocks.rpc }); mocks.permission.mockResolvedValue({});
  mocks.rpc.mockImplementation(async name => ({ error: null, data: name === "bedos_mutate_viewing" ? { record: { id, version: 2 }, notification_events: [] } : name === "bedos_deliver_viewing_event" ? { id, state: "recorded" } : { data: [], pagination: { page: 1, limit: 25, total: 0 } } }));
});
describe("viewing authorization and transport boundaries", () => {
  const calls = [
    () => list(request()), () => collection(request(), context), () => create(request("POST", "broken"), context),
    () => detail(request(), context), () => update(request("PATCH", "broken"), context), () => remove(request("DELETE"), context),
    () => events(request()), () => retry(request("POST", "broken"), eventContext),
  ];
  for (const [i, call] of calls.entries()) {
    it(`rejects anonymous route ${i} before parsing body`, async () => { mocks.context.mockResolvedValue(null); const r = await call(); expect(r.status).toBe(401); expect(r.headers.get("cache-control")).toBe("no-store"); expect(mocks.admin).not.toHaveBeenCalled(); });
    it(`rejects suspended route ${i}`, async () => { mocks.context.mockResolvedValue(user("administrator", "suspended")); expect((await call()).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
    it(`rejects unrelated finance route ${i}`, async () => { mocks.context.mockResolvedValue(user("finance")); expect((await call()).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
  }
  it("uses the customer's verified actor with forced own scope", async () => {
    mocks.context.mockResolvedValue(user());const r = await list(request()); expect(r.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_read_viewings", expect.objectContaining({ p_actor: actor, p_customer: null }));
    expect((await list(request("GET", undefined, "?customer_id=" + id))).status).toBe(400);
  });
  it("uses view permission for staff reading, manage permission for writing", async () => {
    mocks.context.mockResolvedValue(user("sales_customer_service")); expect((await collection(request(), context)).status).toBe(200); expect(mocks.permission).toHaveBeenLastCalledWith("viewings.view");
    expect((await update(request("PATCH", '{"expected_version":1,"status":"contacted"}'), context)).status).toBe(200); expect(mocks.permission).toHaveBeenLastCalledWith("viewings.manage");
    mocks.permission.mockRejectedValue(new ApiError("Forbidden", 403)); expect((await detail(request(), context)).status).toBe(403);
  });
  it("only customers can submit and only administrators can delete or retry", async () => {
    mocks.context.mockResolvedValue(user("sales_customer_service")); expect((await create(request("POST", "{}"), context)).status).toBe(403); expect((await remove(request("DELETE", undefined, "?expected_version=1"), context)).status).toBe(403); expect((await retry(request("POST"), eventContext)).status).toBe(403);
  });
  it("preserves the data response contract and strips the concurrency field from edits", async () => {
    mocks.context.mockResolvedValue(user()); const r = await create(request("POST", '{"message":" Hello "}'), context);
    expect(r.status).toBe(201); expect(await r.json()).toEqual({ data: { id, version: 2 } });
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_mutate_viewing", expect.objectContaining({ p_actor: actor, p_property: id, p_input: { message: "Hello" } }));
  });
  it("validates UUIDs, unknown fields, real dates and pagination before database access", async () => {
    mocks.context.mockResolvedValue(user());
    expect((await detail(request(), { params: Promise.resolve({ id: "invalid", viewingRequestId: id }) })).status).toBe(400);
    for (const body of ['{"status":"new"}', '{"message":5}', '{"preferred_date":"2026-02-29"}', 'null']) expect((await create(request("POST", body), context)).status).toBe(400);
    expect((await update(request("PATCH", '{"message":"missing version"}'), context)).status).toBe(400);
    expect((await list(request("GET", undefined, "?limit=101"))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects missing or repeated deletion preconditions", async () => {
    mocks.context.mockResolvedValue(user("administrator")); expect((await remove(request("DELETE"), context)).status).toBe(400); expect((await remove(request("DELETE", undefined, "?expected_version=1&expected_version=1"), context)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("accepts only bounded empty retry commands and reports durable pending state", async () => {
    mocks.context.mockResolvedValue(user("administrator")); expect((await retry(request("POST", '{"recipient_id":"chosen"}'), eventContext)).status).toBe(400);
    expect((await retry(request("POST", '"' + "x".repeat(1024) + '"'), eventContext)).status).toBe(413);
    mocks.rpc.mockResolvedValue({ data: { id, state: "pending" }, error: null }); const r = await retry(request("POST", "{}"), eventContext); expect(r.status).toBe(202); expect(r.headers.get("cache-control")).toBe("no-store");
    expect(mocks.rpc).toHaveBeenLastCalledWith("bedos_deliver_viewing_event", { p_actor: actor, p_event: id, p_retry: true });
  });
});
