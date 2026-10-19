import { describe, expect, it } from "vitest";
import { findMatchingPaystackRefund } from "./refund-reconciliation";

const expected = {
  refundId: "10000000-0000-4000-8000-000000000123",
  transactionId: 12345,
  amountSubunit: 20000,
  currency: "GHS",
};

const validRefund = {
  id: 98765,
  transaction: 12345,
  amount: 20000,
  currency: "GHS",
  status: "processing",
  merchant_note: `Bedos refund record ${expected.refundId}`,
};

describe("findMatchingPaystackRefund", () => {
  it("matches a valid Paystack refund", () => {
    expect(
      findMatchingPaystackRefund([validRefund], expected),
    ).toEqual(validRefund);
  });

  it("supports a transaction represented as an object", () => {
    const refund = {
      ...validRefund,
      transaction: { id: 12345 },
    };

    expect(
      findMatchingPaystackRefund([refund], expected),
    ).toEqual(refund);
  });

  it("returns null when no matching merchant note exists", () => {
    const refund = {
      ...validRefund,
      merchant_note: "Another refund",
    };

    expect(
      findMatchingPaystackRefund([refund], expected),
    ).toBeNull();
  });

  it("rejects an unknown Paystack refund status", () => {
    const refund = {
      ...validRefund,
      status: "unknown-status",
    };

    expect(() =>
      findMatchingPaystackRefund([refund], expected),
    ).toThrow("Paystack refund details do not match Bedos");
  });
  it("rejects an incorrect refund amount", () => {
    const refund = {
      ...validRefund,
      amount: 10000,
    };

    expect(() =>
      findMatchingPaystackRefund([refund], expected),
    ).toThrow("Paystack refund details do not match Bedos");
  });

  it("rejects a mismatched transaction ID", () => {
    const refund = {
      ...validRefund,
      transaction: 99999,
    };

    expect(() =>
      findMatchingPaystackRefund([refund], expected),
    ).toThrow("Paystack refund details do not match Bedos");
  });

  it("rejects conflicting Paystack refund IDs", () => {
    expect(() =>
      findMatchingPaystackRefund([validRefund], {
        ...expected,
        providerRefundId: "11111",
      }),
    ).toThrow("Paystack refund ID conflicts with Bedos");
  });

  it("rejects duplicate matching refund records", () => {
    const duplicate = {
      ...validRefund,
      id: 98766,
    };

    expect(() =>
      findMatchingPaystackRefund(
        [validRefund, duplicate],
        expected,
      ),
    ).toThrow("Ambiguous Paystack refund records");
  });
});
