import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock, fromMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { createNotification } from "./notification.service";

const input: Parameters<typeof createNotification>[0] = {
  recipient_id: "10000000-0000-4000-8000-000000000002",
  notification_type: "order_confirmed",
  title: "Order confirmed",
  message: "Your order has been confirmed.",
  channel: "in_app",
  related_entity_type: "order",
  related_entity_id: "30000000-0000-4000-8000-000000000001",
};

const existingNotification = {
  id: "50000000-0000-4000-8000-000000000001",
  ...input,
  status: "pending",
};

function mockInsert(data: unknown, error: unknown) {
  const single = vi.fn().mockResolvedValue({ data, error });

  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single }),
  });

  fromMock.mockReturnValueOnce({ insert });

  return { insert };
}

function mockLookup(data: unknown, error: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);

  fromMock.mockReturnValueOnce(query);

  return query;
}

describe("createNotification", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    createAdminClientMock.mockReturnValue({
      from: fromMock,
    });
  });

  it("creates a notification successfully", async () => {

    const { insert } = mockInsert(existingNotification, null);

    const result = await createNotification(input);

    expect(result).toEqual(existingNotification);
    expect(insert).toHaveBeenCalledOnce();
    expect(fromMock).toHaveBeenCalledOnce();
    expect(fromMock).toHaveBeenCalledWith("notifications");
  });

  it("returns an existing order confirmation when insert is duplicate", async () => {
    mockInsert(null, {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "notifications_one_order_confirmed_per_order"',
    });

    const lookup = mockLookup(existingNotification, null);

    const result = await createNotification(input);

    expect(result).toEqual(existingNotification);
    expect(fromMock).toHaveBeenCalledTimes(2);
    expect(lookup.maybeSingle).toHaveBeenCalledOnce();
    expect(lookup.eq).toHaveBeenCalledWith(
      "related_entity_id",
      input.related_entity_id
    );
  });

  it("throws for an unrelated database error", async () => {
    mockInsert(null, {
      code: "42501",
      message: "Permission denied",
    });

    await expect(createNotification(input)).rejects.toThrow(
      "Permission denied"
    );

    expect(fromMock).toHaveBeenCalledOnce();
  });

  it("throws when an existing duplicate notification cannot be loaded", async () => {
    mockInsert(null, {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "notifications_one_order_confirmed_per_order"',
    });

    mockLookup(null, {
      message: "Notification lookup failed",
    });

    await expect(createNotification(input)).rejects.toThrow(
      "Notification lookup failed"
    );

    expect(fromMock).toHaveBeenCalledTimes(2);
  });
});
