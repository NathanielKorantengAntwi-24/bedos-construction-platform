import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  resetPasswordForEmail: vi.fn(),
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
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail: mocks.resetPasswordForEmail,
    },
  }),
}));

import ForgotPasswordPage from "./page";

function renderPage() {
  mocks.cursor = 0;
  return ForgotPasswordPage();
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

  if (!node || typeof node !== "object") return null;

  if (
    node.type === type &&
    (id === undefined || node.props?.id === id)
  ) {
    return node;
  }

  return findElement(node.props?.children, type, id);
}

async function submitEmail(email: string) {
  const page = renderPage();

  findElement(page, "input", "email").props.onChange({
    target: { value: email },
  });

  const form = findElement(renderPage(), "form");

  await form.props.onSubmit({
    preventDefault: vi.fn(),
  });
}

describe("Forgot-password requests", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.slots = [];
    mocks.cursor = 0;

    mocks.resetPasswordForEmail.mockResolvedValue({
      error: null,
    });

    vi.stubGlobal("window", {
      location: {
        origin: "https://bedos-construction-platform.vercel.app",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the recovery form", () => {
    const page = renderPage();

    expect(findElement(page, "form")).toBeTruthy();
    expect(findElement(page, "input", "email")).toBeTruthy();
    expect(findElement(page, "button").props.disabled).toBe(false);
  });

  it("rejects invalid emails", async () => {
    await submitEmail("invalid-email");

    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(mocks.slots[1]).toBe("Enter a valid email address.");
  });

  it("rejects email addresses over 254 characters", async () => {
    await submitEmail(`${"a".repeat(250)}@example.com`);

    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("requests a reset link using the Bedos callback", async () => {
    await submitEmail("  Customer@Example.com  ");

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      "customer@example.com",
      {
        redirectTo:
          "https://bedos-construction-platform.vercel.app/auth/callback?next=%2Fauth%2Fset-password",
      },
    );
  });

  it("shows a generic confirmation on success", async () => {
    await submitEmail("customer@example.com");

    expect(mocks.slots[1]).toContain(
      "If an account exists",
    );
    expect(mocks.slots[2]).toBe(false);
  });

  it("does not expose provider errors or account details", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: {
        message: "User not found",
      },
    });

    await submitEmail("unknown@example.com");

    expect(mocks.slots[1]).toContain(
      "Unable to send a recovery email",
    );
    expect(mocks.slots[1]).not.toContain("User not found");
    expect(mocks.slots[2]).toBe(false);
  });
});