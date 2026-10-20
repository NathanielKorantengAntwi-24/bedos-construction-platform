import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserContext: vi.fn(),
  createClient: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/server/auth/get-user-context", () => ({
  getUserContext: mocks.getUserContext,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET as getMe } from "./me/route";
import { POST as logout } from "./logout/route";

describe("Authentication sessions and logout", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.createClient.mockResolvedValue({
      auth: { signOut: mocks.signOut },
    });
  });

  it("rejects unauthenticated profile requests", async () => {
    mocks.getUserContext.mockResolvedValue(null);

    const response = await getMe();

    expect(response.status).toBe(401);
  });

  it("returns the authenticated user's profile", async () => {
    mocks.getUserContext.mockResolvedValue({
      user: {
        id: "customer-id",
        email: "customer@example.com",
      },
      profile: {
        id: "customer-id",
        full_name: "Test Customer",
        phone: null,
        account_status: "active",
      },
      role: { name: "customer" },
    });

    const response = await getMe();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.email).toBe("customer@example.com");
    expect(body.profile.account_status).toBe("active");
    expect(body.role.name).toBe("customer");
  });

  it("signs out successfully", async () => {
    mocks.signOut.mockResolvedValue({ error: null });

    const response = await logout();

    expect(response.status).toBe(200);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("handles logout failures", async () => {
    mocks.signOut.mockResolvedValue({
      error: { message: "Sign out failed" },
    });

    const response = await logout();

    expect(response.status).toBe(500);
  });

  it("rejects suspended accounts on profile access", async () => {
    mocks.getUserContext.mockResolvedValue({
      user: { id: "suspended-customer" },
      profile: {
        id: "suspended-customer",
        account_status: "suspended",
      },
      role: { name: "customer" },
    });

    const response = await getMe();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Account is not active");
  });

  it("rejects accounts that are not active", async () => {
    mocks.getUserContext.mockResolvedValue({
      user: { id: "pending-customer" },
      profile: {
        id: "pending-customer",
        account_status: "pending",
      },
      role: { name: "customer" },
    });

    const response = await getMe();

    expect(response.status).toBe(403);
  });
});