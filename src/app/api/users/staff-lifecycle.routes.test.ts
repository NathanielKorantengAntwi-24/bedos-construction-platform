import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/http/api-error";
import { POST as activate } from "@/app/api/users/[id]/activate/route";
import { POST as revoke } from "@/app/api/users/[id]/revoke-invitation/route";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/server/auth/require-permission", () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

const actorId = "11111111-1111-4111-8111-111111111111";
const staffId = "22222222-2222-4222-8222-222222222222";
const invitationId = "33333333-3333-4333-8333-333333333333";

const routes = [
  {
    name: "staff activation",
    handler: activate,
    rpcName: "bedos_activate_staff_invitation",
    message: "Staff account activated.",
  },
  {
    name: "invitation revocation",
    handler: revoke,
    rpcName: "bedos_revoke_staff_invitation",
    message: "Staff invitation revoked.",
  },
];

beforeEach(() => {
  vi.clearAllMocks();

  mocks.requirePermission.mockResolvedValue({
    user: { id: actorId },
  });

  mocks.createAdminClient.mockReturnValue({
    rpc: mocks.rpc,
  });

  mocks.rpc.mockResolvedValue({
    data: invitationId,
    error: null,
  });
});

for (const route of routes) {
  const request = (id = staffId) =>
    route.handler(
      new Request(`http://localhost/api/users/${id}`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id }) },
    );

  describe(route.name, () => {
    it("requires the users.manage permission", async () => {
      mocks.requirePermission.mockRejectedValue(
        new ApiError("Forbidden", 403),
      );

      const response = await request();

      expect(response.status).toBe(403);
      expect(mocks.requirePermission).toHaveBeenCalledWith(
        "users.manage",
      );
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("rejects invalid staff identifiers", async () => {
      const response = await request("invalid-id");

      expect(response.status).toBe(400);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("invokes the trusted RPC with the correct identities", async () => {
      const response = await request();

      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith(route.rpcName, {
        p_user_id: staffId,
        p_actor_id: actorId,
      });

      expect(await response.json()).toEqual({
        user_id: staffId,
        invitation_id: invitationId,
        message: route.message,
      });
    });

    it("rejects database authorization failures", async () => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code: "42501" },
      });

      const response = await request();

      expect(response.status).toBe(403);
    });

    it("reports ineligible invitation states as conflicts", async () => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code: "22023" },
      });

      const response = await request();

      expect(response.status).toBe(409);
    });

    it("fails closed on unexpected database errors", async () => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code: "XX000" },
      });

      const response = await request();

      expect(response.status).toBe(500);
    });
  });
}