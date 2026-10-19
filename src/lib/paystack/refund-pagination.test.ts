import { describe, expect, it } from "vitest";
import { validateRefundPagination } from "./refund-pagination";

describe("validateRefundPagination", () => {
  it("accepts valid single-page metadata", () => {
    const result = validateRefundPagination(
      {
        total: 3,
        page: 1,
        perPage: 50,
        pageCount: 1,
      },
      1,
      50,
      3,
    );

    expect(result).toEqual({
      isLastPage: true,
      total: 3,
    });
  });

  it("handles valid multi-page metadata", () => {
    const first = validateRefundPagination(
      {
        total: 75,
        page: 1,
        perPage: 50,
        pageCount: 2,
      },
      1,
      50,
      50,
    );

    const second = validateRefundPagination(
      {
        total: 75,
        page: 2,
        perPage: 50,
        pageCount: 2,
      },
      2,
      50,
      25,
    );

    expect(first.isLastPage).toBe(false);
    expect(second.isLastPage).toBe(true);
  });

  it("rejects missing pagination metadata", () => {
    expect(() =>
      validateRefundPagination(
        undefined,
        1,
        50,
        10,
      ),
    ).toThrow(
      "Missing or invalid refund pagination metadata",
    );
  });

  it("rejects inconsistent pagination information", () => {
    expect(() =>
      validateRefundPagination(
        {
          total: 75,
          page: 2,
          perPage: 50,
          pageCount: 3,
        },
        2,
        50,
        25,
      ),
    ).toThrow(
      "Incomplete or inconsistent refund pagination",
    );
  });

  it("rejects an incomplete refund page", () => {
    expect(() =>
      validateRefundPagination(
        {
          total: 75,
          page: 1,
          perPage: 50,
          pageCount: 2,
        },
        1,
        50,
        20,
      ),
    ).toThrow(
      "Incomplete or inconsistent refund pagination",
    );
  });
});
