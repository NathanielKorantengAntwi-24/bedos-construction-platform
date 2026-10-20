import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET } from "./route";

function callbackRequest(
  code?: string,
  next?: string,
): Request {
  const url = new URL(
    "https://bedos-construction-platform.vercel.app/auth/callback",
  );

  if (code !== undefined) {
    url.searchParams.set("code", code);
  }

  if (next !== undefined) {
    url.searchParams.set("next", next);
  }

  return new Request(url);
}

describe("Authentication callback", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.createClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
      },
    });

    mocks.exchangeCodeForSession.mockResolvedValue({
      error: null,
    });
  });

  it("rejects requests without an authorization code", async () => {
    const response = await GET(callbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://bedos-construction-platform.vercel.app/?error=missing_auth_code",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects invalid authorization codes", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: "Invalid code" },
    });

    const response = await GET(callbackRequest("invalid-code"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://bedos-construction-platform.vercel.app/?error=auth_callback_failed",
    );
  });

  it("returns to homepage after a normal callback", async () => {
    const response = await GET(callbackRequest("valid-code"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://bedos-construction-platform.vercel.app/",
    );
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith(
      "valid-code",
    );
  });

  it("supports an explicit internal password-setup destination", async () => {
    const response = await GET(
      callbackRequest("valid-code", "/auth/set-password"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://bedos-construction-platform.vercel.app/auth/set-password",
    );
  });

  it("rejects external redirect destinations", async () => {
    const response = await GET(
      callbackRequest("valid-code", "//malicious.example"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://bedos-construction-platform.vercel.app/",
    );
  });

  it("shows recovery instructions when a reset code is missing", async () => {
    const response = await GET(
      callbackRequest(undefined, "/auth/set-password"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://bedos-construction-platform.vercel.app/auth/recovery-error",
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("shows recovery instructions when a reset code is invalid", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: "Code expired" },
    });

    const response = await GET(
      callbackRequest("expired-code", "/auth/set-password"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://bedos-construction-platform.vercel.app/auth/recovery-error",
    );
  });

  it("rejects a redirect destination containing a backslash", async () => {
    const response = await GET(
      callbackRequest("valid-code", "/\\malicious.example"),
    );

    expect(response.headers.get("location")).toBe(
      "https://bedos-construction-platform.vercel.app/",
    );
  });

  it("preserves safe internal callback destinations", async () => {
    const response = await GET(
      callbackRequest("valid-code", "/auth/set-password"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://bedos-construction-platform.vercel.app/auth/set-password",
    );
  });
});