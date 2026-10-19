import { paystackRequest, paystackRequestWithMeta } from "./client";
import { validateRefundPagination } from "./refund-pagination";
import { findMatchingPaystackRefund } from "./refund-reconciliation";
import type {
  ExpectedRefund,
} from "./refund-reconciliation";
import type {
  PaystackRefundLookupRecord,
} from "./paystack.types";

const PAGE_SIZE = 50;
const MAX_PAGES = 100;

type TransactionLookup = {
  id: unknown;
  reference: unknown;
  amount: unknown;
  currency: unknown;
  status: unknown;
};

export async function lookupExistingPaystackRefund(
  transactionReference: string,
  expected: Omit<ExpectedRefund, "transactionId">,
): Promise<PaystackRefundLookupRecord | null> {
  if (!transactionReference.trim()) {
    throw new Error("Transaction reference is required");
  }

  const transaction = await paystackRequest<TransactionLookup>(
    `/transaction/verify/${encodeURIComponent(transactionReference)}`,
    { method: "GET" },
  );

  if (
    !transaction ||
    !Number.isSafeInteger(transaction.id) ||
    (transaction.id as number) <= 0 ||
    transaction.reference !== transactionReference ||
    transaction.amount !== expected.amountSubunit ||
    transaction.currency !== expected.currency ||
    (transaction.status !== "success" &&
      transaction.status !== "reversal pending" &&
      transaction.status !== "reversed")
  ) {
    throw new Error(
      "Paystack transaction verification mismatch",
    );
  }

  const transactionId = transaction.id as number;
  const records: PaystackRefundLookupRecord[] = [];
  let expectedTotal: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      transaction: String(transactionId),
      perPage: String(PAGE_SIZE),
      page: String(page),
    });

    const { data: result, meta } =
      await paystackRequestWithMeta<unknown>(
        `/refund?${params.toString()}`,
        { method: "GET" },
      );

    if (!Array.isArray(result)) {
      throw new Error("Invalid Paystack refund list response");
    }

    const pagination = validateRefundPagination(
      meta,
      page,
      PAGE_SIZE,
      result.length,
    );

    if (expectedTotal === null) {
      expectedTotal = pagination.total;
    } else if (expectedTotal !== pagination.total) {
      throw new Error("Refund pagination total changed during lookup");
    }

    records.push(...result);

    if (pagination.isLastPage) {
      return findMatchingPaystackRefund(records, {
        ...expected,
        transactionId,
      });
    }
  }

  throw new Error(
    "Paystack refund pagination limit reached; manual review required",
  );
}
