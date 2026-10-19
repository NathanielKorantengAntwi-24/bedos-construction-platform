import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAdminClientMock,
  lookupMock,
  paystackRequestMock,
  rpcMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  lookupMock: vi.fn(),
  paystackRequestMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/paystack/refund-lookup", () => ({
  lookupExistingPaystackRefund: lookupMock,
}));

vi.mock("@/lib/paystack/client", () => ({
  paystackRequest: paystackRequestMock,
  PaystackRequestError: class PaystackRequestError extends Error {},
}));

import { reconcileExistingPaymentRefund, processPaystackRefundWebhook } from "./payment.service";

const refund = {
  id: "10000000-0000-4000-8000-000000000123",
  payment_id: "20000000-0000-4000-8000-000000000123",
  order_id: "30000000-0000-4000-8000-000000000123",
  provider: "paystack",
  provider_transaction_reference: "BEDOS-TEST-123",
  provider_refund_id: null,
  amount: 200,
  currency: "GHS",
  status: "outcome_unknown",
  provider_status: null,
  reason: "Customer refund",
  initiated_by: "40000000-0000-4000-8000-000000000123",
  failure_code: null,
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
  processed_at: null,
};

describe("reconcileExistingPaymentRefund", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const maybeSingle = vi.fn().mockResolvedValue({
      data: refund,
      error: null,
    });

    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    createAdminClientMock.mockReturnValue({
      from,
      rpc: rpcMock,
    });
  });

  it("never creates another refund when Paystack has no match", async () => {
    lookupMock.mockResolvedValue(null);

    await expect(
      reconcileExistingPaymentRefund(refund.id),
    ).rejects.toMatchObject({
      status: 409,
    });

    expect(paystackRequestMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects ambiguous Paystack lookup results safely", async () => {
    lookupMock.mockRejectedValue(
      new Error("Ambiguous Paystack refund records"),
    );

    await expect(
      reconcileExistingPaymentRefund(refund.id),
    ).rejects.toMatchObject({
      status: 503,
    });

    expect(paystackRequestMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("uses atomic completion for a verified processed refund", async () => {
    lookupMock.mockResolvedValue({
      id: 98765,
      status: "processed",
    });

    rpcMock.mockResolvedValue({
      data: {
        ...refund,
        status: "processed",
        provider_refund_id: "98765",
      },
      error: null,
    });

    const result = await reconcileExistingPaymentRefund(
      refund.id,
    );

    expect(result.status).toBe("processed");

    expect(rpcMock).toHaveBeenCalledWith(
      "complete_payment_refund",
      expect.objectContaining({
        p_provider_transaction_reference:
          refund.provider_transaction_reference,
        p_provider_refund_id: "98765",
        p_amount_subunit: 20000,
        p_currency: "GHS",
      }),
    );

    expect(paystackRequestMock).not.toHaveBeenCalled();
  });

  it("requires reconciliation when atomic completion fails", async () => {
    lookupMock.mockResolvedValue({
      id: 98765,
      status: "processed",
    });

    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "P0001" },
    });

    await expect(
      reconcileExistingPaymentRefund(refund.id),
    ).rejects.toMatchObject({
      status: 503,
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "complete_payment_refund",
      expect.any(Object),
    );

    expect(paystackRequestMock).not.toHaveBeenCalled();
  });

  it("updates processing refunds without creating another refund", async () => {
    lookupMock.mockResolvedValue({
      id: 98765,
      status: "processing",
    });

    rpcMock.mockResolvedValue({
      data: {
        ...refund,
        status: "processing",
        provider_status: "processing",
        provider_refund_id: "98765",
      },
      error: null,
    });

    const result = await reconcileExistingPaymentRefund(
      refund.id,
    );

    expect(result.status).toBe("processing");

    expect(rpcMock).toHaveBeenCalledWith(
      "update_payment_refund_status",
      expect.objectContaining({
        p_status: "processing",
        p_provider_status: "processing",
        p_provider_refund_id: "98765",
        p_amount_subunit: 20000,
        p_currency: "GHS",
      }),
    );

    expect(paystackRequestMock).not.toHaveBeenCalled();
  });

  it.each(["failed", "rejected"] as const)(
    "rejects failed and rejected refunds without contacting Paystack: %s",
    async (status) => {
      const maybeSingle = vi.fn().mockResolvedValue({
        data: { ...refund, status },
        error: null,
      });

      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const select = vi.fn().mockReturnValue({ eq });
      const from = vi.fn().mockReturnValue({ select });

      createAdminClientMock.mockReturnValue({
        from,
        rpc: rpcMock,
      });

      await expect(
        reconcileExistingPaymentRefund(refund.id),
      ).rejects.toMatchObject({
        status: 409,
      });

      expect(lookupMock).not.toHaveBeenCalled();
      expect(rpcMock).not.toHaveBeenCalled();
      expect(paystackRequestMock).not.toHaveBeenCalled();
    },
  );

  it("stops reconciliation when refund database read fails", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST500" },
    });

    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    createAdminClientMock.mockReturnValue({
      from,
      rpc: rpcMock,
    });

    await expect(
      reconcileExistingPaymentRefund(refund.id),
    ).rejects.toMatchObject({
      status: 500,
    });

    expect(lookupMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(paystackRequestMock).not.toHaveBeenCalled();
  });

  it("rejects refund amounts with fractional subunits", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        ...refund,
        amount: 200.001,
      },
      error: null,
    });

    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    createAdminClientMock.mockReturnValue({
      from,
      rpc: rpcMock,
    });

    await expect(
      reconcileExistingPaymentRefund(refund.id),
    ).rejects.toMatchObject({
      status: 503,
    });

    expect(lookupMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(paystackRequestMock).not.toHaveBeenCalled();
  });

  it("handles already processed refunds without Paystack lookup", async () => {
    const processedRefund = {
      ...refund,
      status: "processed",
      provider_status: "processed",
      provider_refund_id: "98765",
      processed_at: "2026-10-19T00:00:00Z",
    };

    const maybeSingle = vi.fn().mockResolvedValue({
      data: processedRefund,
      error: null,
    });

    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    createAdminClientMock.mockReturnValue({
      from,
      rpc: rpcMock,
    });

    rpcMock.mockResolvedValue({
      data: processedRefund,
      error: null,
    });

    const result = await reconcileExistingPaymentRefund(
      refund.id,
    );

    expect(result.status).toBe("processed");

    expect(rpcMock).toHaveBeenCalledExactlyOnceWith(
      "complete_payment_refund",
      expect.objectContaining({
        p_provider_transaction_reference:
          refund.provider_transaction_reference,
        p_provider_refund_id: "98765",
        p_amount_subunit: 20000,
        p_currency: "GHS",
      }),
    );

    expect(lookupMock).not.toHaveBeenCalled();
    expect(paystackRequestMock).not.toHaveBeenCalled();
  });

  it("rejects failed refund status persistence", async () => {
    lookupMock.mockResolvedValue({
      id: 98765,
      status: "processing",
    });

    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "P0001" },
    });

    await expect(
      reconcileExistingPaymentRefund(refund.id),
    ).rejects.toMatchObject({
      status: 503,
    });

    expect(rpcMock).toHaveBeenCalledExactlyOnceWith(
      "update_payment_refund_status",
      expect.objectContaining({
        p_status: "processing",
        p_provider_status: "processing",
        p_provider_refund_id: "98765",
        p_amount_subunit: 20000,
        p_currency: "GHS",
      }),
    );

    expect(paystackRequestMock).not.toHaveBeenCalled();
  });

  it("rejects processed refund webhook without verified identity", async () => {
    lookupMock.mockResolvedValue(null);

    rpcMock.mockResolvedValue({
      data: {
        ...refund,
        status: "processed",
      },
      error: null,
    });

    await expect(
      processPaystackRefundWebhook({
        event: "refund.processed",
        transactionReference:
          refund.provider_transaction_reference,
        amountSubunit: 20000,
        currency: "GHS",
        providerStatus: "processed",
      }),
    ).rejects.toMatchObject({
      status: 503,
    });

    expect(lookupMock).toHaveBeenCalledOnce();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(paystackRequestMock).not.toHaveBeenCalled();
  });

  it("completes webhook refund using verified Paystack refund ID", async () => {
    lookupMock.mockResolvedValue({
      id: 98765,
      status: "processed",
    });

    rpcMock.mockResolvedValue({
      data: {
        ...refund,
        status: "processed",
        provider_status: "processed",
        provider_refund_id: "98765",
        processed_at: "2026-10-19T00:00:00Z",
      },
      error: null,
    });

    const result = await processPaystackRefundWebhook({
      event: "refund.processed",
      transactionReference:
        refund.provider_transaction_reference,
      amountSubunit: 20000,
      currency: "GHS",
      providerStatus: "processed",
    });

    expect(result.status).toBe("processed");
    expect(result.provider_refund_id).toBe("98765");

    expect(lookupMock).toHaveBeenCalledExactlyOnceWith(
      refund.provider_transaction_reference,
      expect.objectContaining({
        refundId: refund.id,
        amountSubunit: 20000,
        currency: "GHS",
        providerRefundId: null,
      }),
    );

    expect(rpcMock).toHaveBeenCalledExactlyOnceWith(
      "complete_payment_refund",
      expect.objectContaining({
        p_provider_transaction_reference:
          refund.provider_transaction_reference,
        p_provider_refund_id: "98765",
        p_amount_subunit: 20000,
        p_currency: "GHS",
      }),
    );

    expect(paystackRequestMock).not.toHaveBeenCalled();
  });

  it("rejects webhook completion when Paystack refund is still processing", async () => {
    lookupMock.mockResolvedValue({
      id: 98765,
      status: "processing",
    });

    await expect(
      processPaystackRefundWebhook({
        event: "refund.processed",
        transactionReference:
          refund.provider_transaction_reference,
        amountSubunit: 20000,
        currency: "GHS",
        providerStatus: "processed",
      }),
    ).rejects.toMatchObject({
      status: 503,
    });

    expect(lookupMock).toHaveBeenCalledOnce();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(paystackRequestMock).not.toHaveBeenCalled();
  });

  it("rejects webhook with conflicting Paystack refund ID", async () => {
    createAdminClientMock.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { ...refund, provider_refund_id: "11111" },
              error: null,
            }),
          }),
        }),
      }),
      rpc: rpcMock,
    });

    lookupMock.mockRejectedValue(new Error("Refund ID conflict"));

    await expect(processPaystackRefundWebhook({
      event: "refund.processed",
      transactionReference: refund.provider_transaction_reference,
      amountSubunit: 20000,
      currency: "GHS",
      providerStatus: "processed",
    })).rejects.toMatchObject({ status: 503 });

    expect(lookupMock).toHaveBeenCalledWith(
      refund.provider_transaction_reference,
      expect.objectContaining({ providerRefundId: "11111" }),
    );
    expect(rpcMock).not.toHaveBeenCalled();
    expect(paystackRequestMock).not.toHaveBeenCalled();
  });
});