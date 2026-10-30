import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  setSession: vi.fn(),
  getSession: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("react", () => ({
  useEffect: (callback: () => void) => callback(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
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

  it("does not handle unrelated token types", () => {
    setupBrowser(
      "#access_token=test-access&refresh_token=test-refresh&type=signup",
    );

    InvitationHandler();

    expect(window.location.href).toBe("https://bedos.example/");
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("establishes server-initiated recovery sessions before password setup", async () => {
    setupBrowser("#access_token=test-access&refresh_token=test-refresh&type=recovery");
    mocks.setSession.mockResolvedValue({ error: null });

    InvitationHandler();

    await vi.waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/auth/set-password");
    });
    expect(mocks.setSession).toHaveBeenCalledWith({
      access_token: "test-access", refresh_token: "test-refresh",
    });
    expect(window.history.replaceState).toHaveBeenCalledWith({}, "Bedos", "/");
  });

  it("removes tokens before creating the PKCE browser client", async () => {
    setupBrowser("#access_token=test-access&refresh_token=test-refresh&type=invite");
    mocks.setSession.mockResolvedValue({ error: null });
    mocks.createClient.mockImplementation(() => {
      expect(window.history.replaceState).toHaveBeenCalledWith({}, "Bedos", "/");
      return { auth: { setSession: mocks.setSession } };
    });

    InvitationHandler();

    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/auth/set-password"));
  });

  it("shows recovery instructions when session establishment fails", async () => {
    setupBrowser("#access_token=test-access&refresh_token=test-refresh&type=invite");
    mocks.setSession.mockResolvedValue({ error: { code: "bad_jwt", status: 401 } });

    InvitationHandler();

    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/auth/recovery-error"));
    expect(window.history.replaceState).toHaveBeenCalledOnce();
  });

  it("handles unexpected SDK failures without leaving credentials in the URL", async () => {
    setupBrowser("#access_token=test-access&refresh_token=test-refresh&type=recovery");
    mocks.setSession.mockRejectedValue(new Error("Synthetic SDK failure"));

    InvitationHandler();

    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/auth/recovery-error"));
    expect(window.history.replaceState).toHaveBeenCalledOnce();
  });

  it("leaves ordinary PKCE callbacks to the server callback route", () => {
    setupBrowser("");
    window.location.href = "https://bedos.example/?code=test-code";

    InvitationHandler();

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(window.history.replaceState).not.toHaveBeenCalled();
    expect(window.location.href).toBe("https://bedos.example/?code=test-code");
  });

  it("does not consume the same fragment twice when an effect runs again", async () => {
    setupBrowser("#access_token=test-access&refresh_token=test-refresh&type=recovery");
    mocks.setSession.mockResolvedValue({ error: null });
    vi.mocked(window.history.replaceState).mockImplementation(() => {
      window.location.hash = "";
    });

    InvitationHandler();
    InvitationHandler();

    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/auth/set-password"));
    expect(mocks.setSession).toHaveBeenCalledOnce();
  });

  it("redirects after a valid invitation session", async () => {
    setupBrowser(
      "#access_token=test-access&refresh_token=test-refresh&type=invite",
    );

    mocks.setSession.mockResolvedValue({ error: null });

    InvitationHandler();

    await vi.waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith("/auth/set-password");
    });

    expect(mocks.setSession).toHaveBeenCalledWith({
      access_token: "test-access",
      refresh_token: "test-refresh",
    });

    expect(window.history.replaceState).toHaveBeenCalledOnce();
  });

  it("removes incomplete credentials and shows recovery instructions", () => {
    setupBrowser("#access_token=test-access&type=invite");

    InvitationHandler();

    expect(mocks.replace).toHaveBeenCalledWith("/auth/recovery-error");
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(window.history.replaceState).toHaveBeenCalledOnce();
  });
});
