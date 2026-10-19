import type {
  PaystackRefundLookupRecord,
} from "./paystack.types";

export type ExpectedRefund = {
  refundId: string;
  transactionId: number;
  amountSubunit: number;
  currency: string;
  providerRefundId?: string | null;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function getTransactionId(value: unknown): unknown {
  if (isRecord(value)) {
    return value.id;
  }

  return value;
}

/**
 * Match a Bedos refund to a Paystack refund record.
 *
 * This function does not:
 * - Create refunds
 * - Send network requests
 * - Update database records
 */
export function findMatchingPaystackRefund(
  records: unknown,
  expected: ExpectedRefund,
): PaystackRefundLookupRecord | null {
  if (
    !Array.isArray(records) ||
    !Number.isSafeInteger(expected.transactionId) ||
    expected.transactionId <= 0 ||
    !Number.isSafeInteger(expected.amountSubunit) ||
    expected.amountSubunit <= 0 ||
    !expected.refundId ||
    !expected.currency
  ) {
    throw new Error("Invalid refund reconciliation input");
  }

  const merchantNote =
    `Bedos refund record ${expected.refundId}`;

  const matches = records.filter(
    (record: unknown) =>
      isRecord(record) &&
      record.merchant_note === merchantNote,
  );

  if (matches.length === 0) {
    return null;
  }

  if (matches.length !== 1) {
    throw new Error(
      "Ambiguous Paystack refund records; manual review required",
    );
  }

  const refund = matches[0];

  const transactionId = getTransactionId(
    refund.transaction,
  );

  const validStatus =
    refund.status === "pending" ||
    refund.status === "processing" ||
    refund.status === "needs-attention" ||
    refund.status === "processed" ||
    refund.status === "failed";

  if (
    !validStatus ||
    !Number.isSafeInteger(refund.id) ||
    refund.id <= 0 ||
    transactionId !== expected.transactionId ||
    refund.amount !== expected.amountSubunit ||
    refund.currency !== expected.currency
  ) {
    throw new Error(
      "Paystack refund details do not match Bedos",
    );
  }

  if (
    expected.providerRefundId != null &&
    String(refund.id) !== expected.providerRefundId
  ) {
    throw new Error(
      "Paystack refund ID conflicts with Bedos",
    );
  }

  return refund as PaystackRefundLookupRecord;
}
