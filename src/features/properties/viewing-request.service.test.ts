import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn(), deliver: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/features/notifications/notification.service", () => ({ deliverViewingNotificationEvent: mocks.deliver }));
import { createViewingRequest, deleteViewingRequest, getViewingRequest, listViewingRequests, retryViewingNotificationEvent, updateViewingRequest } from "./viewing-request.service";
const actor = "11111111-1111-4111-8111-111111111111", property = "22222222-2222-4222-8222-222222222222";
beforeEach(() => { vi.resetAllMocks(); mocks.admin.mockReturnValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: { record: { id: property, version: 1 }, notification_events: [actor] }, error: null }); mocks.deliver.mockResolvedValue({ event: { id: actor, state: "recorded" }, errorCode: null }); });
describe("viewing commit and notification boundary", () => {
  it("binds verified actor and immutable property outside customer fields", async () => {
    expect(await createViewingRequest({ property_id: property, message: "Request" }, actor)).toEqual({ data: { id: property, version: 1 } });
    expect(mocks.rpc).toHaveBeenCalledWith("bedos_mutate_viewing", expect.objectContaining({ p_actor: actor, p_property: property, p_input: { message: "Request" } }));
    expect(mocks.deliver).toHaveBeenCalledWith(actor, actor);
  });
  it("preserves committed viewing when event processing is unavailable", async () => {
    mocks.deliver.mockResolvedValue({ event: null, errorCode: "UNAVAILABLE" });
    expect(await createViewingRequest({ property_id: property }, actor)).toEqual({ data: { id: property, version: 1 }, notifications_pending: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("bounds immediate event fanout and leaves the rest durable", async () => {
    mocks.rpc.mockResolvedValue({ data: { record: { id: property }, notification_events: Array.from({ length: 11 }, (_, i) => String(i)) }, error: null });
    expect((await createViewingRequest({ property_id: property }, actor)).notifications_pending).toBe(true);
    expect(mocks.deliver).toHaveBeenCalledTimes(10);
  });
  it("sends versions as trusted preconditions rather than editable record fields", async () => {
    await updateViewingRequest(property, actor, { expected_version: 2, status: "contacted" }, actor);
    expect(mocks.rpc).toHaveBeenLastCalledWith("bedos_mutate_viewing", expect.objectContaining({ p_expected_version: 2, p_input: { status: "contacted" } }));
    await deleteViewingRequest(property, actor, actor, 3);
    expect(mocks.rpc).toHaveBeenLastCalledWith("bedos_mutate_viewing", expect.objectContaining({ p_action: "delete", p_expected_version: 3, p_input: {} }));
  });
  for (const [code, status] of [["P0409", 409], ["P0001", 409], ["55P03", 409], ["42501", 403], ["P0002", 404], ["22023", 400], ["XX000", 503]] as const) {
    it("maps private database failure " + code, async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "Secret provider detail" } });
      await expect(createViewingRequest({ property_id: property }, actor)).rejects.toMatchObject({ status });
      expect(mocks.deliver).not.toHaveBeenCalled();
    });
  }
  it("does not replay an uncertain business commit", async () => { mocks.rpc.mockRejectedValue(new Error("Network failure")); await expect(createViewingRequest({ property_id: property }, actor)).rejects.toMatchObject({ status: 503 }); expect(mocks.rpc).toHaveBeenCalledTimes(1); });
  it("uses guarded own/staff reads and explicit administrator event retry", async () => {
    await listViewingRequests(actor, { page: 2, limit: 25 }); expect(mocks.rpc).toHaveBeenLastCalledWith("bedos_read_viewings", expect.objectContaining({ p_actor: actor, p_customer: null, p_page: 2 }));
    await getViewingRequest(property, property, actor); expect(mocks.rpc).toHaveBeenLastCalledWith("bedos_read_viewings", { p_actor: actor, p_property: property, p_id: property });
    await retryViewingNotificationEvent(actor, property); expect(mocks.deliver).toHaveBeenLastCalledWith(actor, property, true);
  });
});
