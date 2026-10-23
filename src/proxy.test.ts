import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { proxy } from "./proxy";

type CookieEntry = {
  name: string;
  value: string;
  options?: {
    path?: string;
    httpOnly?: boolean;
    sameSite?: "lax" | "strict" | "none";
  };
};

type CookieAdapter = {
  getAll: () => CookieEntry[];
  setAll: (cookies: CookieEntry[]) => void;
};

let cookieAdapter: CookieAdapter | null = null;

function adapter(): CookieAdapter {
  if (!cookieAdapter) {
    throw new Error("Supabase cookie adapter was not initialized.");
  }

  return cookieAdapter;
}

describe("Supabase proxy session handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cookieAdapter = null;

    mocks.getUser.mockResolvedValue({
      data: { user: { id: "test-user" } },
      error: null,
    });

    mocks.createServerClient.mockImplementation(
      (
        _url: string,
        _key: string,
        options: { cookies: CookieAdapter },
      ) => {
        cookieAdapter = options.cookies;

        return {
          auth: {
            getUser: mocks.getUser,
          },
        };
      },
    );
  });

  it("verifies the user on each matched request", async () => {
    const request = new NextRequest(
      "https://bedos.example/api/auth/me",
    );

    const response = await proxy(request);

    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it("passes existing session cookies to Supabase", async () => {
    const request = new NextRequest(
      "https://bedos.example/api/auth/me",
      {
        headers: {
          cookie: "existing-session=present",
        },
      },
    );

    await proxy(request);

    expect(adapter().getAll()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "existing-session",
          value: "present",
        }),
      ]),
    );
  });

  it("persists refreshed cookies in request and response", async () => {
    const request = new NextRequest(
      "https://bedos.example/api/auth/me",
    );

    mocks.getUser.mockImplementation(async () => {
      adapter().setAll([
        {
          name: "sb-session-test",
          value: "refreshed-value",
          options: {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
          },
        },
      ]);

      return {
        data: { user: { id: "test-user" } },
        error: null,
      };
    });

    const response = await proxy(request);

    expect(request.cookies.get("sb-session-test")?.value).toBe(
      "refreshed-value",
    );

    expect(response.cookies.get("sb-session-test")?.value).toBe(
      "refreshed-value",
    );
  });

  it("does not treat an invalid user as verified", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Session expired" },
    });

    const request = new NextRequest(
      "https://bedos.example/api/auth/me",
    );

    await proxy(request);

    expect(mocks.getUser).toHaveBeenCalledOnce();
  });
});