import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effectStarted: false,
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();

  return {
    ...original,
    useState: (initial: unknown) => {
      const index = mocks.cursor++;

      if (!(index in mocks.slots)) {
        mocks.slots[index] = initial;
      }

      return [
        mocks.slots[index],
        (value: unknown) => {
          mocks.slots[index] = value;
        },
      ];
    },
    useEffect: (callback: () => void) => {
      if (!mocks.effectStarted) {
        mocks.effectStarted = true;
        callback();
      }
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      updateUser: mocks.updateUser,
    },
  }),
}));

import SetPasswordPage from "./page";

function renderPage() {
  mocks.cursor = 0;
  return SetPasswordPage();
}

function findElement(
  node: any,
  type: string,
  id?: string,
): any {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = findElement(child, type, id);
      if (result) return result;
    }
    return null;
  }

  if (!node || typeof node !== "object") {
    return null;
  }

  if (
    node.type === type &&
    (id === undefined || node.props?.id === id)
  ) {
    return node;
  }

  return findElement(node.props?.children, type, id);
}

function enterPasswords(password: string, confirmation: string) {
  const page = renderPage();

  findElement(page, "input", "password").props.onChange({
    target: { value: password },
  });

  findElement(page, "input", "confirm-password").props.onChange({
    target: { value: confirmation },
  });
}

async function submitPassword() {
  const form = findElement(renderPage(), "form");

  await form.props.onSubmit({
    preventDefault: vi.fn(),
  });
}

describe("Password setup security", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.slots = [];
    mocks.cursor = 0;
    mocks.effectStarted = false;

    mocks.getUser.mockReset();
    mocks.updateUser.mockReset();

    mocks.getUser.mockResolvedValue({
      data: { user: { id: "test-user" } },
      error: null,
    });

    mocks.updateUser.mockResolvedValue({ error: null });
  });

  it("disables password setup without a session", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    renderPage();

    await vi.waitFor(() => {
      expect(mocks.slots[4]).toBe(false);
    });

    const button = findElement(renderPage(), "button");

    expect(button.props.disabled).toBe(true);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rejects passwords shorter than eight characters", async () => {
    renderPage();

    await vi.waitFor(() => {
      expect(mocks.slots[4]).toBe(true);
    });

    enterPasswords("short", "short");
    await submitPassword();

    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.slots[2]).toContain("at least 8");
  });

  it("rejects mismatched passwords", async () => {
    renderPage();

    await vi.waitFor(() => {
      expect(mocks.slots[4]).toBe(true);
    });

    enterPasswords("Password123!", "Different123!");
    await submitPassword();

    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.slots[2]).toContain("do not match");
  });

  it("updates a valid password and clears the form", async () => {
    renderPage();

    await vi.waitFor(() => {
      expect(mocks.slots[4]).toBe(true);
    });

    enterPasswords("Password123!", "Password123!");
    await submitPassword();

    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: "Password123!",
    });

    expect(mocks.slots[0]).toBe("");
    expect(mocks.slots[1]).toBe("");
    expect(mocks.slots[2]).toBe("Password set successfully.");
    expect(mocks.slots[3]).toBe(false);
  });

  it("handles password provider errors", async () => {
    mocks.updateUser.mockResolvedValue({
      error: { message: "Password update rejected" },
    });

    renderPage();

    await vi.waitFor(() => {
      expect(mocks.slots[4]).toBe(true);
    });

    enterPasswords("Password123!", "Password123!");
    await submitPassword();

    expect(mocks.slots[2]).toBe("Password update rejected");
    expect(mocks.slots[3]).toBe(false);
  });

  it("rejects a session that expires before submission", async () => {
    mocks.getUser
      .mockResolvedValueOnce({
        data: { user: { id: "test-user" } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

    renderPage();

    await vi.waitFor(() => {
      expect(mocks.slots[4]).toBe(true);
    });

    enterPasswords("Password123!", "Password123!");
    await submitPassword();

    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.slots[4]).toBe(false);
    expect(mocks.slots[2]).toContain("expired");
  });
});