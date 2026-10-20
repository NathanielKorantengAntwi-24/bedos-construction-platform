import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserContext: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/server/auth/get-user-context", () => ({
  getUserContext: mocks.getUserContext,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { PATCH } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Authenticated profile updates", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.getUserContext.mockResolvedValue({
      user: { id: "customer-1" },
      profile: {
        id: "customer-1",
        account_status: "active",
      },
      role: { name: "customer" },
    });

    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: "customer-1",
        full_name: "Ama Mensah",
        phone: "0241234567",
        account_status: "active",
      },
      error: null,
    });

    mocks.select.mockReturnValue({
      maybeSingle: mocks.maybeSingle,
    });

    mocks.eq.mockReturnValue({
      eq: mocks.eq,
      select: mocks.select,
    });

    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.from.mockReturnValue({ update: mocks.update });

    mocks.createClient.mockResolvedValue({
      from: mocks.from,
    });
  });

  it("rejects unauthenticated users", async () => {
    mocks.getUserContext.mockResolvedValue(null);

    const response = await PATCH(
      request({ full_name: "Ama Mensah" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects suspended accounts", async () => {
    mocks.getUserContext.mockResolvedValue({
      user: { id: "customer-1" },
      profile: { account_status: "suspended" },
    });

    const response = await PATCH(
      request({ full_name: "Ama Mensah" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects an empty update", async () => {
    const response = await PATCH(request({}));

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects protected account fields", async () => {
    const response = await PATCH(
      request({
        full_name: "Ama Mensah",
        role_id: "administrator",
        account_status: "active",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("validates the full name", async () => {
    const response = await PATCH(
      request({ full_name: "A" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("validates the phone number", async () => {
    const response = await PATCH(
      request({ phone: 12345 }),
    );

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates permitted profile fields", async () => {
    const response = await PATCH(
      request({
        full_name: "  Ama Mensah  ",
        phone: "0241234567",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      full_name: "Ama Mensah",
      phone: "0241234567",
    });
    expect(mocks.eq).toHaveBeenCalledWith(
      "id",
      "customer-1",
    );
    expect(mocks.eq).toHaveBeenCalledWith(
      "account_status",
      "active",
    );
  });

  it("allows clearing an optional phone number", async () => {
    const response = await PATCH(
      request({ phone: null }),
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      phone: null,
    });
  });

  it("rejects changes when the active row disappears", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const response = await PATCH(
      request({ full_name: "Ama Mensah" }),
    );

    expect(response.status).toBe(403);
  });

  it("handles database update failures", async () => {
    const consoleSpy = vi.spyOn(
      console,
      "error",
    ).mockImplementation(() => {});

    try {
      mocks.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: "Database error" },
      });

      const response = await PATCH(
        request({ full_name: "Ama Mensah" }),
      );

      expect(response.status).toBe(500);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});