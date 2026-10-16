import { ApiError } from "@/server/http/api-error";
import type { CreateOrderInput } from "./order.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_ORDER_ITEMS = 50;
const MAX_DELIVERY_ADDRESS_LENGTH = 500;
const MAX_DELIVERY_NOTES_LENGTH = 1000;

export function validateCreateOrderInput(
  value: unknown,
): CreateOrderInput {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ApiError("Request body must be an object", 400);
  }

  const body = value as Record<string, unknown>;

  const allowedFields = new Set([
    "items",
    "delivery_address",
    "delivery_notes",
  ]);

  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    throw new ApiError("Request contains unsupported fields", 400);
  }

  if (
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    body.items.length > MAX_ORDER_ITEMS
  ) {
    throw new ApiError(
      `Items must contain between 1 and ${MAX_ORDER_ITEMS} products`,
      400,
    );
  }

  const seenProductIds = new Set<string>();

  const items = body.items.map((item: unknown) => {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item)
    ) {
      throw new ApiError("Each order item must be an object", 400);
    }

    const entry = item as Record<string, unknown>;

    if (
      typeof entry.product_id !== "string" ||
      !UUID_PATTERN.test(entry.product_id)
    ) {
      throw new ApiError("Each product must have a valid product ID", 400);
    }

    const productId = entry.product_id.toLowerCase();

    if (seenProductIds.has(productId)) {
      throw new ApiError(
        "A product may appear only once in an order",
        400,
      );
    }

    seenProductIds.add(productId);

    if (
      typeof entry.quantity !== "number" ||
      !Number.isSafeInteger(entry.quantity) ||
      entry.quantity <= 0
    ) {
      throw new ApiError(
        "Each quantity must be a positive integer",
        400,
      );
    }

    return {
      product_id: productId,
      quantity: entry.quantity,
    };
  });

  const deliveryAddress = body.delivery_address;
  const deliveryNotes = body.delivery_notes;

  if (
    deliveryAddress !== undefined &&
    deliveryAddress !== null &&
    (typeof deliveryAddress !== "string" ||
      deliveryAddress.length > MAX_DELIVERY_ADDRESS_LENGTH)
  ) {
    throw new ApiError("Delivery address is invalid or too long", 400);
  }

  if (
    deliveryNotes !== undefined &&
    deliveryNotes !== null &&
    (typeof deliveryNotes !== "string" ||
      deliveryNotes.length > MAX_DELIVERY_NOTES_LENGTH)
  ) {
    throw new ApiError("Delivery notes are invalid or too long", 400);
  }

  return {
    items,
    delivery_address: deliveryAddress as string | null | undefined,
    delivery_notes: deliveryNotes as string | null | undefined,
  };
}
