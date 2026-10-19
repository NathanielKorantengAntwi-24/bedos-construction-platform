export function validateRefundPagination(
  meta: unknown,
  requestedPage: number,
  requestedPageSize: number,
  actualRecordCount: number,
): { isLastPage: boolean; total: number } {
  if (
    typeof meta !== "object" ||
    meta === null ||
    Array.isArray(meta)
  ) {
    throw new Error("Missing or invalid refund pagination metadata");
  }

  const value = meta as Record<string, unknown>;

  if (
    !Number.isSafeInteger(value.total) ||
    (value.total as number) < 0 ||
    !Number.isSafeInteger(value.page) ||
    value.page !== requestedPage ||
    !Number.isSafeInteger(value.perPage) ||
    value.perPage !== requestedPageSize ||
    !Number.isSafeInteger(value.pageCount) ||
    !Number.isSafeInteger(actualRecordCount)
  ) {
    throw new Error("Inconsistent refund pagination metadata");
  }

  const total = value.total as number;
  const pageCount = value.pageCount as number;
  const expectedPageCount = Math.ceil(total / requestedPageSize);

  const expectedRecords = Math.min(
    requestedPageSize,
    Math.max(0, total - (requestedPage - 1) * requestedPageSize),
  );

  if (
    requestedPage < 1 ||
    requestedPageSize < 1 ||
    pageCount !== expectedPageCount ||
    requestedPage > Math.max(1, pageCount) ||
    actualRecordCount !== expectedRecords
  ) {
    throw new Error("Incomplete or inconsistent refund pagination");
  }

  return {
    isLastPage: requestedPage >= pageCount,
    total,
  };
}
