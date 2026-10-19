import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  paystackRequest,
  paystackRequestWithMeta,
} from "./client";
import { lookupExistingPaystackRefund } from "./refund-lookup";

vi.mock("./client", () => ({
  paystackRequest: vi.fn(),
  paystackRequestWithMeta: vi.fn(),
}));

const request = vi.mocked(paystackRequest);
const listRequest = vi.mocked(paystackRequestWithMeta);

const refundId = "10000000-0000-4000-8000-000000000123";
const reference = "BEDOS-TEST-REF-123";

const expected = {
  refundId,
  amountSubunit: 20000,
  currency: "GHS",
};

const transaction = {
  id: 12345,
  reference,
  amount: 20000,
  currency: "GHS",
  status: "success",
};

const refund = {
  id: 98765,
  transaction: 12345,
  amount: 20000,
  currency: "GHS",
  status: "processing",
  merchant_note: `Bedos refund record ${refundId}`,
};

function pageResult(
  data: unknown[],
  page: number,
  total: number,
) {
  return {
    data,
    meta: {
      total,
      page,
      perPage: 50,
      pageCount: Math.ceil(total / 50),
    },
  };
}

describe("lookupExistingPaystackRefund", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("finds a matching existing refund", async () => {
    request.mockResolvedValueOnce(transaction);
    listRequest.mockResolvedValueOnce(
      pageResult([refund], 1, 1),
    );

    const result = await lookupExistingPaystackRefund(
      reference,
      expected,
    );

    expect(result).toEqual(refund);
    expect(request).toHaveBeenCalledTimes(1);
    expect(listRequest).toHaveBeenCalledTimes(1);
    expect(listRequest.mock.calls[0][0]).toContain(
      "/refund?transaction=12345",
    );
  });

  it("rejects a transaction reference mismatch", async () => {
    request.mockResolvedValueOnce({
      ...transaction,
      reference: "WRONG-REFERENCE",
    });

    await expect(
      lookupExistingPaystackRefund(reference, expected),
    ).rejects.toThrow(
      "Paystack transaction verification mismatch",
    );

    expect(listRequest).not.toHaveBeenCalled();
  });

  it("rejects an unsuccessful original transaction", async () => {
    request.mockResolvedValueOnce({
      ...transaction,
      status: "failed",
    });

    await expect(
      lookupExistingPaystackRefund(reference, expected),
    ).rejects.toThrow(
      "Paystack transaction verification mismatch",
    );

    expect(listRequest).not.toHaveBeenCalled();
  });

  it.each(["reversal pending", "reversed"])(
    "accepts original transaction status %s",
    async (status) => {
      request.mockResolvedValueOnce({
        ...transaction,
        status,
      });

      listRequest.mockResolvedValueOnce(
        pageResult([refund], 1, 1),
      );

      const result = await lookupExistingPaystackRefund(
        reference,
        expected,
      );

      expect(result).toEqual(refund);
    },
  );

  it("finds a refund on the second page", async () => {
    const otherRefunds = Array.from(
      { length: 50 },
      (_, index) => ({
        ...refund,
        id: index + 1,
        merchant_note: `Other refund ${index}`,
      }),
    );

    request.mockResolvedValueOnce(transaction);

    listRequest
      .mockResolvedValueOnce(pageResult(otherRefunds, 1, 51))
      .mockResolvedValueOnce(pageResult([refund], 2, 51));

    const result = await lookupExistingPaystackRefund(
      reference,
      expected,
    );

    expect(result).toEqual(refund);
    expect(listRequest).toHaveBeenCalledTimes(2);
    expect(listRequest.mock.calls[1][0]).toContain("page=2");
  });

  it("rejects a malformed refund list", async () => {
    request.mockResolvedValueOnce(transaction);

    listRequest.mockResolvedValueOnce({
      data: { unexpected: "response" },
      meta: {
        total: 1,
        page: 1,
        perPage: 50,
        pageCount: 1,
      },
    });

    await expect(
      lookupExistingPaystackRefund(reference, expected),
    ).rejects.toThrow(
      "Invalid Paystack refund list response",
    );
  });

  it("rejects ambiguous refunds across pages", async () => {
    const firstPage = Array.from(
      { length: 50 },
      (_, index) => ({
        ...refund,
        id: index + 1,
        merchant_note: `Other refund ${index}`,
      }),
    );

    firstPage[0] = refund;

    const duplicate = {
      ...refund,
      id: 99999,
    };

    request.mockResolvedValueOnce(transaction);

    listRequest
      .mockResolvedValueOnce(pageResult(firstPage, 1, 51))
      .mockResolvedValueOnce(pageResult([duplicate], 2, 51));

    await expect(
      lookupExistingPaystackRefund(reference, expected),
    ).rejects.toThrow("Ambiguous Paystack refund records");
  });

  it("rejects an incomplete scan at the pagination limit", async () => {
    const fullPage = Array.from(
      { length: 50 },
      (_, index) => ({
        ...refund,
        id: index + 1,
        merchant_note: `Unrelated refund ${index}`,
      }),
    );

    request.mockResolvedValueOnce(transaction);

    for (let page = 1; page <= 100; page++) {
      listRequest.mockResolvedValueOnce(
        pageResult(fullPage, page, 5001),
      );
    }

    await expect(
      lookupExistingPaystackRefund(reference, expected),
    ).rejects.toThrow(
      "Paystack refund pagination limit reached",
    );

    expect(listRequest).toHaveBeenCalledTimes(100);
  });

  it("rejects missing pagination metadata", async () => {
    request.mockResolvedValueOnce(transaction);

    listRequest.mockResolvedValueOnce({
      data: [refund],
      meta: undefined,
    });

    await expect(
      lookupExistingPaystackRefund(reference, expected),
    ).rejects.toThrow(
      "Missing or invalid refund pagination metadata",
    );
  });

  it("rejects changing totals between pages", async () => {
    const otherRefunds = Array.from(
      { length: 50 },
      (_, index) => ({
        ...refund,
        id: index + 1,
        merchant_note: `Other refund ${index}`,
      }),
    );

    request.mockResolvedValueOnce(transaction);

    listRequest
      .mockResolvedValueOnce(pageResult(otherRefunds, 1, 51))
      .mockResolvedValueOnce(pageResult([refund, refund], 2, 52));

    await expect(
      lookupExistingPaystackRefund(reference, expected),
    ).rejects.toThrow(
      "Refund pagination total changed during lookup",
    );
  });
});
