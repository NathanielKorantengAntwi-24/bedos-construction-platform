import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
import { deliverViewingNotificationEvent } from "./notification.service";
beforeEach(() => { vi.resetAllMocks(); mocks.admin.mockReturnValue({ rpc: mocks.rpc }); });
it("materializes only a server-recorded viewing event", async () => {
  mocks.rpc.mockResolvedValue({ data: { id: "event", state: "recorded" }, error: null });
  expect(await deliverViewingNotificationEvent("actor", "event")).toEqual({ event: { id: "event", state: "recorded" }, errorCode: null });
  expect(mocks.rpc).toHaveBeenCalledWith("bedos_deliver_viewing_event", { p_actor: "actor", p_event: "event", p_retry: false });
});
it("returns a safe pending failure without exposing provider text", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Private diagnostic" } });
  expect(await deliverViewingNotificationEvent("actor", "event", true)).toEqual({ event: null, errorCode: "42501" });
  mocks.rpc.mockRejectedValue(new Error("Private network diagnostic"));
  expect(await deliverViewingNotificationEvent("actor", "event")).toEqual({ event: null, errorCode: "UNAVAILABLE" });
});
