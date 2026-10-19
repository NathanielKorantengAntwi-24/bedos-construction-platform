import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  paystackRequest,
  paystackRequestWithMeta,
} from "./client";

describe("Paystack client response metadata", () => {
  beforeEach(() => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_mock_only");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("preserves metadata for pagination-aware callers", async () => {
    const data = [{ id: 123, status: "processing" }];
    const meta = {
      total: 1,
      page: 1,
      perPage: 50,
      pageCount: 1,
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data,
          meta,
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", mockFetch);

    const result = await paystackRequestWithMeta(
      "/refund?page=1&perPage=50",
      { method: "GET" },
    );

    expect(result).toEqual({ data, meta });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    expect(mockFetch.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("preserves the existing data-only response", async () => {
    const data = { id: 12345, status: "success" };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: true,
            data,
            meta: { page: 1 },
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await paystackRequest(
      "/transaction/verify/TEST",
      { method: "GET" },
    );

    expect(result).toEqual(data);
  });

  it("allows missing metadata to remain undefined", async () => {
    const data = [{ id: 98765 }];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: true,
            data,
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await paystackRequestWithMeta(
      "/refund",
      { method: "GET" },
    );

    expect(result).toEqual({
      data,
      meta: undefined,
    });
  });

  it("classifies HTTP 400 as a known rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: false,
            message: "Invalid request",
          }),
          { status: 400 },
        ),
      ),
    );

    await expect(
      paystackRequestWithMeta("/refund", {
        method: "GET",
      }),
    ).rejects.toMatchObject({
      name: "PaystackRequestError",
      code: "http",
      outcomeUnknown: false,
    });
  });

  it("classifies HTTP 503 as an uncertain outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: false,
            message: "Service unavailable",
          }),
          { status: 503 },
        ),
      ),
    );

    await expect(
      paystackRequestWithMeta("/refund", {
        method: "GET",
      }),
    ).rejects.toMatchObject({
      name: "PaystackRequestError",
      code: "http",
      outcomeUnknown: true,
    });
  });

  it("rejects a missing provider success indicator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { id: 123 },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      paystackRequest("/transaction/verify/TEST"),
    ).rejects.toMatchObject({
      name: "PaystackRequestError",
      code: "response",
      outcomeUnknown: true,
    });
  });
  it("rejects a null Paystack response safely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("null", { status: 200 }),
      ),
    );

    await expect(
      paystackRequest("/transaction/verify/TEST"),
    ).rejects.toMatchObject({
      name: "PaystackRequestError",
      code: "response",
      outcomeUnknown: true,
    });
  });

  it.each([
    [
      "Headers instance",
      new Headers({
        Authorization: "Bearer unsafe_override",
        "X-Bedos-Test": "preserved",
      }),
    ],
    [
      "plain object",
      {
        Authorization: "Bearer unsafe_override",
        "X-Bedos-Test": "preserved",
      },
    ],
  ])("protects Paystack authorization for %s", async (_type, headers) => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: { id: 123 },
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", mockFetch);

    await paystackRequest("/transaction/verify/TEST", {
      method: "GET",
      headers,
    });

    const sentHeaders = new Headers(
      mockFetch.mock.calls[0][1].headers,
    );

    expect(sentHeaders.get("Authorization")).toBe(
      "Bearer sk_test_mock_only",
    );

    expect(sentHeaders.get("X-Bedos-Test")).toBe(
      "preserved",
    );
  });
});
