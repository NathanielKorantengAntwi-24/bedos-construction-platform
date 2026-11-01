import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./[id]/resume-invitation/route";
import { ApiError } from "@/server/http/api-error";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), admin: vi.fn(), rpc: vi.fn(), lookup: vi.fn(), invite: vi.fn(), recovery: vi.fn() }));
vi.mock("@/server/auth/require-permission", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const actor = "10000000-0000-4000-8000-000000000001", id = "abcdef12-0000-4000-8000-000000000001", invitation = "30000000-0000-4000-8000-000000000001";
const prepared = { user_id: id, invitation_id: invitation, email: "staff@example.invalid", method: "invite", attempt_number: 1 };
const originalOrigin = process.env.BEDOS_APP_ORIGIN;
function request(body: unknown = { reason: "  Resume review  " }, target = id, query = "", raw = false) {
  return POST(new Request(`https://test.invalid/api/users/${target}/resume-invitation${query}`, { method: "POST", body: raw ? String(body) : JSON.stringify(body) }), { params: Promise.resolve({ id: target }) });
}
beforeEach(() => {
  vi.clearAllMocks();process.env.BEDOS_APP_ORIGIN = "https://bedos.example.invalid";
  mocks.permission.mockResolvedValue({ user: { id: actor } });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "bedos_prepare_staff_invitation_retry" ? { ...prepared } : invitation, error: null }));
  mocks.lookup.mockResolvedValue({ data: { user: { id, email: prepared.email, email_confirmed_at: null } }, error: null });
  mocks.invite.mockResolvedValue({ data: { user: { id } }, error: null });
  mocks.recovery.mockResolvedValue({ error: null });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc, auth: { admin: { getUserById: mocks.lookup, inviteUserByEmail: mocks.invite }, resetPasswordForEmail: mocks.recovery } });
});
afterEach(() => { if (originalOrigin === undefined) delete process.env.BEDOS_APP_ORIGIN; else process.env.BEDOS_APP_ORIGIN = originalOrigin; });
describe("trusted staff setup resume", () => {
  for (const status of [401, 403]) it(`requires users.manage before validation (${status})`, async () => {
    mocks.permission.mockRejectedValue(new ApiError("Denied", status));
    expect((await request("{", "bad", "", true)).status).toBe(status);
    expect(mocks.permission).toHaveBeenCalledWith("users.manage");expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("checks setup then uses existing guarded retry with canonical target and actor", async () => {
    const r = await request({ reason: "  Resume review  " }, id.toUpperCase());
    expect(r.status).toBe(202);expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(["bedos_setup_staff_invitation", "bedos_prepare_staff_invitation_retry", "bedos_finish_staff_invitation_retry"]);
    expect(mocks.rpc.mock.calls[0][1]).toEqual({ p_user_id: id, p_actor_id: actor, p_reason: "Resume review", p_resume: true });
    expect(mocks.invite).toHaveBeenCalledWith(prepared.email, { redirectTo: "https://bedos.example.invalid/" });
    expect(await r.json()).toEqual({ user_id: id, invitation_id: invitation, recovery_method: "invite", message: "Staff onboarding email request accepted." });
  });
  for (const body of [null, [], {}, "body", { reason: "" }, { reason: "\t\n" }, { reason: "x".repeat(501) }, { reason: "a\0b" }, { reason: "ok", role_id: id }, { reason: "ok", email: prepared.email }, { reason: "ok", actor_id: actor }]) {
    it(`rejects malformed/extra fields ${JSON.stringify(body).slice(0, 55)}`, async () => {
      const r = await request(body);expect(r.status).toBe(400);expect(mocks.admin).not.toHaveBeenCalled();
    });
  }
  it("rejects malformed JSON, target and query", async () => {
    expect((await request("{", id, "", true)).status).toBe(400);
    expect((await request({ reason: "ok" }, "invalid")).status).toBe(400);
    expect((await request({ reason: "ok" }, id, "?force=true")).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("checks trusted origin before any setup write", async () => {
    process.env.BEDOS_APP_ORIGIN = "http://untrusted.invalid/path";
    expect((await request()).status).toBe(503);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  for (const [code, status] of [["42501", 403], ["22023", 400], ["P0002", 404], ["P0001", 409], ["23514", 500]] as const) {
    it(`classifies setup ${code} without dispatch or private details`, async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private marker or audit reason" } });
      const r = await request();expect(r.status).toBe(status);expect(await r.text()).not.toContain("private marker");expect(mocks.lookup).not.toHaveBeenCalled();
    });
  }
  it("does not accept missing setup proof", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });expect((await request()).status).toBe(500);expect(mocks.invite).not.toHaveBeenCalled();
  });
  it("rejects mismatched setup/retry invitation identity before email", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "bedos_prepare_staff_invitation_retry" ? { ...prepared, invitation_id: actor } : invitation, error: null }));
    expect((await request()).status).toBe(500);expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("preserves retry cooldown", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "bedos_prepare_staff_invitation_retry" ? { data: null, error: { code: "P0001" } } : { data: invitation, error: null });
    expect((await request()).status).toBe(429);expect(mocks.invite).not.toHaveBeenCalled();
  });
  it("audits provider rejection then returns safe 502", async () => {
    mocks.invite.mockResolvedValue({ data: { user: null }, error: { message: "private provider message" } });
    const r = await request();expect(r.status).toBe(502);expect(await r.text()).not.toContain("private provider");
    expect(mocks.rpc.mock.calls[2][1].p_accepted).toBe(false);
  });
  it("does not claim success when outcome audit fails after accepted email", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "bedos_finish_staff_invitation_retry" ? { data: null, error: { code: "23514" } } : { data: name === "bedos_prepare_staff_invitation_retry" ? prepared : invitation, error: null });
    expect((await request()).status).toBe(500);expect(mocks.invite).toHaveBeenCalledOnce();
  });
  it("uses confirmed-user recovery instead of invitation", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "bedos_prepare_staff_invitation_retry" ? { ...prepared, method: "recovery" } : invitation, error: null }));
    mocks.lookup.mockResolvedValue({ data: { user: { id, email: prepared.email, email_confirmed_at: "2026-11-01" } }, error: null });
    const r = await request();expect(r.status).toBe(202);expect(mocks.invite).not.toHaveBeenCalled();expect(mocks.recovery).toHaveBeenCalledWith(prepared.email, { redirectTo: "https://bedos.example.invalid/" });
  });
});
