import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.stubEnv("BEDOS_APP_ORIGIN", "https://bedos-construction-platform.vercel.app");
    mocks.createClient.mockReset();
    mocks.signUp.mockReset();

    mocks.createClient.mockResolvedValue({
      auth: { signUp: mocks.signUp },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
        emailRedirectTo: "https://bedos-construction-platform.vercel.app/auth/callback",
        data: {
          full_name: "Test Customer",
          phone: null,
        },
      },
    });
    expect(await response.json()).toMatchObject({
      confirmation_required: true,
      message: "Check your email to confirm your account before signing in.",
    });
  });

  it("does not derive confirmation redirects from request headers", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const response = await POST(new Request("https://attacker.example/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json", host: "attacker.example" },
      body: JSON.stringify({ email: "test@example.com", password: "password123", full_name: "Test Customer" }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
      "https://bedos-construction-platform.vercel.app/auth/callback",
    );
  });

  it("rejects invalid confirmation origins before contacting Auth", async () => {
    for (const origin of ["invalid", "https://user:pass@example.com", "https://example.com/path", "https://example.com?next=bad", "http://attacker.example"]) {
      vi.stubEnv("BEDOS_APP_ORIGIN", origin);
      const response = await POST(signupRequest({ email: "test@example.com", password: "password123", full_name: "Test Customer" }));
      expect(response.status).toBe(503);
    }
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("uses the approved HTTPS production origin when no override is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BEDOS_APP_ORIGIN", "");
    mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    expect((await POST(signupRequest({ email: "test@example.com", password: "password123", full_name: "Test Customer" }))).status).toBe(201);
    expect(mocks.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
      "https://bedos-construction-platform.vercel.app/auth/callback",
    );
  });

  it("rejects HTTP origins in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BEDOS_APP_ORIGIN", "http://localhost:3000");
    expect((await POST(signupRequest({ email: "test@example.com", password: "password123", full_name: "Test Customer" }))).status).toBe(503);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("preserves successful signup responses when Auth establishes a session", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { id: "test-user-id" }, session: { access_token: "test-only" } }, error: null });
    const response = await POST(signupRequest({ email: "test@example.com", password: "password123", full_name: "Test Customer" }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.confirmation_required).toBe(false);
    expect(body.message).toBe("Account created successfully");
    expect(body.session).toBeUndefined();
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
