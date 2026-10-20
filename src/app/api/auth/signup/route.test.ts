import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { POST } from "./route";

function signupRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Customer signup API", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.signUp.mockReset();

    mocks.createClient.mockResolvedValue({
      auth: { signUp: mocks.signUp },
    });
  });

  it("rejects invalid registration data", async () => {
    const invalidBodies = [
      null,
      [],
      {},
      "invalid",
      {
        email: 123,
        password: "password123",
        full_name: "Test Customer",
      },
      {
        email: "invalid-email",
        password: "password123",
        full_name: "Test Customer",
      },
      {
        email: "test@example.com",
        password: 123,
        full_name: "Test Customer",
      },
      {
        email: "test@example.com",
        password: "short",
        full_name: "Test Customer",
      },
      {
        email: "test@example.com",
        password: "password123",
        full_name: "",
      },
      {
        email: "test@example.com",
        password: "password123",
        full_name: "Test Customer",
        phone: 123,
      },
    ];

    for (const body of invalidBodies) {
      const response = await POST(signupRequest(body));
      expect(response.status).toBe(400);
    }

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("accepts valid registration details", async () => {
    mocks.signUp.mockResolvedValue({
      data: {
        user: {
          id: "test-user-id",
          email: "test@example.com",
        },
      },
      error: null,
    });

    const response = await POST(
      signupRequest({
        email: "test@example.com",
        password: "password123",
        full_name: "Test Customer",
      }),
    );

    expect(response.status).toBe(201);

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "password123",
      options: {
        data: {
          full_name: "Test Customer",
          phone: null,
        },
      },
    });
  });

  it("handles Supabase signup errors", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null },
      error: { message: "Registration failed" },
    });

    const response = await POST(
      signupRequest({
        email: "test@example.com",
        password: "password123",
        full_name: "Test Customer",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const request = new Request(
      "http://localhost/api/auth/signup",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{invalid-json",
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});