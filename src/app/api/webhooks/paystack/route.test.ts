import { createHmac } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { refundHandlerMock, paymentHandlerMock } = vi.hoisted(
  () => ({
    refundHandlerMock: vi.fn(),
    paymentHandlerMock: vi.fn(),
  }),
);

vi.mock("@/features/payments/payment.service", () => ({
  processPaystackRefundWebhook: refundHandlerMock,
  processPaystackWebhookPayment: paymentHandlerMock,
}));

import { POST } from "./route";

const TEST_SECRET = "bedos-webhook-unit-test-secret";

let originalSecret: string | undefined;

beforeAll(() => {
  originalSecret = process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_SECRET_KEY = TEST_SECRET;
});

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.PAYSTACK_SECRET_KEY;
  } else {
    process.env.PAYSTACK_SECRET_KEY = originalSecret;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(
  body: string,
  signature?: string,
): Request {
  const headers = new Headers({
    "content-type": "application/json",
  });

  if (signature !== undefined) {
    headers.set("x-paystack-signature", signature);
  }

  return new Request(
    "http://localhost/api/webhooks/paystack",
    {
      method: "POST",
      headers,
      body,
    },
  );
}

function signPayload(body: string): string {
  return createHmac("sha512", TEST_SECRET)
    .update(body)
    .digest("hex");
}

describe("Paystack webhook security", () => {
  it("rejects missing signatures", async () => {
    const response = await POST(
      makeRequest("{}"),
    );

    expect(response.status).toBe(401);
    expect(refundHandlerMock).not.toHaveBeenCalled();
    expect(paymentHandlerMock).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures", async () => {
    const body = JSON.stringify({
      event: "refund.processing",
    });

    const response = await POST(
      makeRequest(body, "00".repeat(64)),
    );

    expect(response.status).toBe(401);
    expect(refundHandlerMock).not.toHaveBeenCalled();
    expect(paymentHandlerMock).not.toHaveBeenCalled();
  });

  it("accepts a correctly signed refund event", async () => {
    const body = JSON.stringify({
      event: "refund.processing",
      data: {
        status: "processing",
        transaction_reference: "BEDOS-TEST-123",
        amount: 20000,
        currency: "GHS",
      },
    });

    refundHandlerMock.mockResolvedValue({
      status: "processing",
    });

    const response = await POST(
      makeRequest(body, signPayload(body)),
    );

    expect(response.status).toBe(200);

    expect(refundHandlerMock).toHaveBeenCalledExactlyOnceWith({
      event: "refund.processing",
      transactionReference: "BEDOS-TEST-123",
      amountSubunit: 20000,
      currency: "GHS",
      providerStatus: "processing",
    });

    expect(paymentHandlerMock).not.toHaveBeenCalled();
  });

  it("rejects correctly signed malformed JSON", async () => {
    const body = '{"event":';

    const response = await POST(
      makeRequest(body, signPayload(body)),
    );

    expect(response.status).toBe(400);
    expect(refundHandlerMock).not.toHaveBeenCalled();
    expect(paymentHandlerMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported refund events", async () => {
    const body = JSON.stringify({
      event: "refund.cancelled",
      data: {
        status: "cancelled",
        transaction_reference: "BEDOS-TEST-123",
        amount: 20000,
        currency: "GHS",
      },
    });

    const response = await POST(
      makeRequest(body, signPayload(body)),
    );

    expect(response.status).toBe(400);
    expect(refundHandlerMock).not.toHaveBeenCalled();
    expect(paymentHandlerMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched refund event and status", async () => {
    const body = JSON.stringify({
      event: "refund.processed",
      data: {
        status: "failed",
        transaction_reference: "BEDOS-TEST-123",
        amount: 20000,
        currency: "GHS",
      },
    });

    const response = await POST(
      makeRequest(body, signPayload(body)),
    );

    expect(response.status).toBe(400);
    expect(refundHandlerMock).not.toHaveBeenCalled();
    expect(paymentHandlerMock).not.toHaveBeenCalled();
  });
});