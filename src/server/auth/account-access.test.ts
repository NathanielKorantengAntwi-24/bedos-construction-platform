import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserContext: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("./get-user-context", () => ({
  getUserContext: mocks.getUserContext,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { requireRole } from "./require-role";
import { requirePermission } from "./require-permission";

const activeUser = {
  user: { id: "test-user-id" },
  profile: {
    role_id: "test-role-id",
    account_status: "active",
  },
  role: { name: "customer" },
};

describe("Account restrictions and permissions", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.getUserContext.mockResolvedValue(activeUser);

    mocks.eq.mockResolvedValue({
      data: [{ permissions: { name: "orders.view" } }],
      error: null,
    });

    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.createClient.mockResolvedValue({ from: mocks.from });
  });

  it("rejects unauthenticated users", async () => {
    mocks.getUserContext.mockResolvedValue(null);

    await expect(requireRole(["customer"]))
      .rejects.toMatchObject({ status: 401 });

    await expect(requirePermission("orders.view"))
      .rejects.toMatchObject({ status: 401 });
  });

  it("blocks inactive accounts", async () => {
    mocks.getUserContext.mockResolvedValue({
      ...activeUser,
      profile: {
        ...activeUser.profile,
        account_status: "suspended",
      },
    });

    await expect(requireRole(["customer"]))
      .rejects.toMatchObject({ status: 403 });

    await expect(requirePermission("orders.view"))
      .rejects.toMatchObject({ status: 403 });

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("allows an authorized role", async () => {
    await expect(requireRole(["customer"]))
      .resolves.toEqual(activeUser);
  });

  it("rejects an unauthorized role", async () => {
    await expect(requireRole(["administrator"]))
      .rejects.toMatchObject({ status: 403 });
  });

  it("allows an assigned permission", async () => {
    await expect(requirePermission("orders.view"))
      .resolves.toEqual(activeUser);

    expect(mocks.eq).toHaveBeenCalledWith(
      "role_id",
      "test-role-id",
    );
  });

  it("rejects a missing permission", async () => {
    await expect(requirePermission("users.manage"))
      .rejects.toMatchObject({ status: 403 });
  });

  it("handles database permission lookup errors", async () => {
    mocks.eq.mockResolvedValue({
      data: null,
      error: { message: "Database error" },
    });

    await expect(requirePermission("orders.view"))
      .rejects.toMatchObject({ status: 500 });
  });
});