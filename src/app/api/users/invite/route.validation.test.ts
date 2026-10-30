import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/http/api-error";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  adminClient: vi.fn(),
}));

vi.mock("@/server/auth/require-permission", () => ({
  requirePermission: mocks.permission,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.adminClient,
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/users/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const valid = {
  email: "staff@example.com",
  full_name: "Test Staff",
  role_id: "20000000-0000-4000-8000-000000000001",
};

async function expectInvalid(bodies: unknown[]) {
  for (const body of bodies) {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
  }

  expect(mocks.adminClient).not.toHaveBeenCalled();
}

describe("Staff invitation input validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.permission.mockResolvedValue({
      user: { id: "administrator-id" },
    });
  });

  it("rejects non-object request bodies", async () => {
    await expectInvalid([null, [], "invalid", 123]);
  });

  it("rejects incorrect field types", async () => {
    await expectInvalid([
      { ...valid, email: 123 },
      { ...valid, full_name: 123 },
      { ...valid, role_id: 123 },
      { ...valid, phone: 123 },
      {},
    ]);
  });

  it("rejects missing or blank required fields", async () => {
    await expectInvalid([
      { ...valid, email: "" },
      { ...valid, full_name: "  " },
      { ...valid, role_id: "" },
    ]);
  });

  it("rejects invalid or excessively long fields", async () => {
    await expectInvalid([
      { ...valid, email: "invalid-email" },
      { ...valid, email: "a".repeat(250) + "@x.io" },
      { ...valid, full_name: "a".repeat(201) },
      { ...valid, phone: "1".repeat(41) },
    ]);
  });

  it("rejects malformed role UUIDs before constructing a privileged client", async () => {
    await expectInvalid([
      { ...valid, role_id: "not-a-uuid" },
      { ...valid, role_id: "20000000-0000-4000-8000-00000000000Z" },
    ]);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/users/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{invalid-json",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });

  it("rejects users without invitation permission", async () => {
    mocks.permission.mockRejectedValue(
      new ApiError("Forbidden", 403),
    );

    const response = await POST(request(valid));

    expect(response.status).toBe(403);
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });
});
