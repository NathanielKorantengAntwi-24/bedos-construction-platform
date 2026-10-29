import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { POST } from "./route";

function loginRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Customer login API", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: "test-customer-id",
          email: "customer@example.com",
        },
      },
      error: null,
    });

    mocks.signOut.mockResolvedValue({ error: null });

    mocks.single.mockResolvedValue({
      data: { account_status: "active" },
      error: null,
    });

    mocks.eq.mockReturnValue({ single: mocks.single });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.from.mockReturnValue({ select: mocks.select });

    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
        signOut: mocks.signOut,
      },
      from: mocks.from,
    });
  });

  it("rejects invalid request bodies with HTTP 400", async () => {
    const invalidBodies = [
      null,
      [],
      {},
      { email: 123, password: "password123" },
      { email: "customer@example.com", password: 123 },
      { email: "", password: "password123" },
    ];

    for (const body of invalidBodies) {
      const response = await POST(loginRequest(body));
      expect(response.status).toBe(400);
    }

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before contacting authentication", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON request body",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("keeps unexpected authentication errors private", async () => {
    const failure = new Error("Private infrastructure details");
    const consoleSpy = vi.spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.createClient.mockRejectedValue(failure);

    try {
      const response = await POST(
        loginRequest({ email: "customer@example.com", password: "password123" }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error" });
      expect(consoleSpy).toHaveBeenCalledWith(failure);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("allows valid customer login", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: "test-customer-id",
          email: "customer@example.com",
        },
      },
      error: null,
    });

    const response = await POST(
      loginRequest({
        email: "customer@example.com",
        password: "password123",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "customer@example.com",
      password: "password123",
    });
  });

  it("rejects incorrect credentials", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid credentials" },
    });

    const response = await POST(
      loginRequest({
        email: "customer@example.com",
        password: "wrongpassword",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects suspended customers and signs out", async () => {
    mocks.single.mockResolvedValue({
      data: { account_status: "suspended" },
      error: null,
    });

    const response = await POST(
      loginRequest({
        email: "customer@example.com",
        password: "password123",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.eq).toHaveBeenCalledWith(
      "id",
      "test-customer-id",
    );
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("rejects pending customers", async () => {
    mocks.single.mockResolvedValue({
      data: { account_status: "pending" },
      error: null,
    });

    const response = await POST(
      loginRequest({
        email: "customer@example.com",
        password: "password123",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("fails closed when the profile is missing", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: null,
    });

    const response = await POST(
      loginRequest({
        email: "customer@example.com",
        password: "password123",
      }),
    );

    expect(response.status).toBe(503);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("fails closed when profile lookup returns an error", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "Database unavailable" },
    });

    const response = await POST(
      loginRequest({
        email: "customer@example.com",
        password: "password123",
      }),
    );

    expect(response.status).toBe(503);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("fails closed when profile lookup throws", async () => {
    const consoleSpy = vi.spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      mocks.single.mockRejectedValue(
        new Error("Database connection failed"),
      );

      const response = await POST(
        loginRequest({
          email: "customer@example.com",
          password: "password123",
        }),
      );

      expect(response.status).toBe(503);
      expect(mocks.signOut).toHaveBeenCalledOnce();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("rejects login if session cleanup fails", async () => {
    const consoleSpy = vi.spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      mocks.single.mockResolvedValue({
        data: { account_status: "suspended" },
        error: null,
      });

      mocks.signOut.mockResolvedValue({
        error: { message: "Sign-out failed" },
      });

      const response = await POST(
        loginRequest({
          email: "customer@example.com",
          password: "password123",
        }),
      );

      expect(response.status).toBe(500);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("rejects a successful sign-in without a user", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await POST(
      loginRequest({
        email: "customer@example.com",
        password: "password123",
      }),
    );

    expect(response.status).toBe(503);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
