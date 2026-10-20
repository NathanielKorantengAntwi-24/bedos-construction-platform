import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { getUserContext } from "./get-user-context";

describe("Verified authentication sessions", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "customer-1",
          email: "customer@example.com",
        },
      },
      error: null,
    });

    mocks.single.mockResolvedValue({
      data: {
        id: "customer-1",
        full_name: "Test Customer",
        phone: null,
        role_id: "customer-role",
        account_status: "active",
        roles: { id: "customer-role", name: "customer" },
      },
      error: null,
    });

    mocks.eq.mockReturnValue({ single: mocks.single });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.from.mockReturnValue({ select: mocks.select });

    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
    });
  });

  it("accepts a verified user with a valid profile", async () => {
    const context = await getUserContext();

    expect(context?.user.id).toBe("customer-1");
    expect(context?.profile.account_status).toBe("active");
    expect(context?.role?.name).toBe("customer");
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.eq).toHaveBeenCalledWith("id", "customer-1");
  });

  it("rejects an expired or revoked session", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Session expired" },
    });

    const context = await getUserContext();

    expect(context).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects a session without a verified user", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const context = await getUserContext();

    expect(context).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects a user whose profile is missing", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: null,
    });

    expect(await getUserContext()).toBeNull();
  });

  it("fails closed when the profile lookup fails", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "Database unavailable" },
    });

    expect(await getUserContext()).toBeNull();
  });

  it("passes account status to authorization guards", async () => {
    mocks.single.mockResolvedValue({
      data: {
        id: "customer-1",
        role_id: "customer-role",
        account_status: "suspended",
        roles: { id: "customer-role", name: "customer" },
      },
      error: null,
    });

    const context = await getUserContext();

    expect(context?.profile.account_status).toBe("suspended");
  });

  it("normalizes roles returned as an array", async () => {
    mocks.single.mockResolvedValue({
      data: {
        id: "customer-1",
        role_id: "customer-role",
        account_status: "active",
        roles: [
          { id: "customer-role", name: "customer" },
        ],
      },
      error: null,
    });

    const context = await getUserContext();

    expect(context?.role?.name).toBe("customer");
  });
});