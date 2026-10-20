import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  setSession: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("react", () => ({
  useEffect: (callback: () => void) => callback(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

import InvitationHandler from "./InvitationHandler";

function setupBrowser(hash: string) {
  vi.stubGlobal("window", {
    location: {
      hash,
      pathname: "/",
      href: "https://bedos.example/",
    },
    history: {
      replaceState: vi.fn(),
    },
  });

  vi.stubGlobal("document", {
    title: "Bedos",
  });
}

describe("Invitation redirect handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.createClient.mockReturnValue({
      auth: {
        setSession: mocks.setSession,
        getSession: mocks.getSession,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not redirect ordinary visitors", () => {
    setupBrowser("");

    InvitationHandler();

    expect(window.location.href).toBe("https://bedos.example/");
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("does not redirect for non-invitation tokens", () => {
    setupBrowser(
      "#access_token=test-access&refresh_token=test-refresh&type=recovery",
    );

    InvitationHandler();

    expect(window.location.href).toBe("https://bedos.example/");
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("redirects after a valid invitation session", async () => {
    setupBrowser(
      "#access_token=test-access&refresh_token=test-refresh&type=invite",
    );

    mocks.setSession.mockResolvedValue({ error: null });

    InvitationHandler();

    await vi.waitFor(() => {
      expect(window.location.href).toBe("/auth/set-password");
    });

    expect(mocks.setSession).toHaveBeenCalledWith({
      access_token: "test-access",
      refresh_token: "test-refresh",
    });

    expect(window.history.replaceState).toHaveBeenCalledOnce();
  });

  it("does not redirect when invitation tokens are incomplete", () => {
    setupBrowser("#access_token=test-access&type=invite");

    InvitationHandler();

    expect(window.location.href).toBe("https://bedos.example/");
    expect(mocks.setSession).not.toHaveBeenCalled();
  });
});