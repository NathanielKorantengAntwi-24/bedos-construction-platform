import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithPassword: vi.fn(),
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
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
      },
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
});