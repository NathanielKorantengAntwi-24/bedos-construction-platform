import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import { createNotification } from "@/features/notifications/notification.service";
import type {
  CreateOrderInput,
  Order,
  OrderItem,
  OrderStatus,
  UpdateOrderInput,
} from "./order.types";

export async function createOrder(
  customerId: string,
  input: CreateOrderInput,
): Promise<Order> {
  if (!customerId) {
    throw new Error("Customer is required");
  }

  if (!input.items || input.items.length === 0) {
    throw new Error("At least one product is required");
  }

  const admin = createAdminClient();

  const { data: orderId, error: createError } = await admin.rpc(
    "create_order",
    {
      p_customer_id: customerId,
      p_items: input.items,
      p_delivery_address: input.delivery_address ?? null,
      p_delivery_notes: input.delivery_notes ?? null,
    },
  );

  if (createError || !orderId) {
    throw new Error(
      createError?.message ?? "Failed to create order",
    );
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select(
      `
        id,
        customer_id,
        order_number,
        status,
        subtotal,
        delivery_fee,
        discount,
        total_amount,
        currency,
        delivery_address,
        delivery_notes,
        created_at,
        updated_at,
        order_items (
          id,
          order_id,
          product_id,
          product_name,
          unit_price,
          quantity,
          subtotal,
          created_at
        )
      `,
    )
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    throw new Error(
      orderError?.message ?? "Failed to retrieve created order",
    );
  }

  await createNotification({
  recipient_id: customerId,
  notification_type: "order_created",
  title: "Order placed successfully",
  message: `Your order ${order.order_number} has been placed successfully.`,
  channel: "in_app",
  related_entity_type: "order",
  related_entity_id: order.id,
});

  return {
    ...order,
    items: order.order_items ?? [],
  } as Order;
}

export async function listCustomerOrders(
  customerId: string,
): Promise<Order[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("orders")
    .select(`
      id,
      customer_id,
      order_number,
      status,
      subtotal,
      delivery_fee,
      discount,
      total_amount,
      currency,
      delivery_address,
      delivery_notes,
      created_at,
      updated_at,
      order_items (
        id,
        order_id,
        product_id,
        product_name,
        unit_price,
        quantity,
        subtotal,
        created_at
      )
    `)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((order) => ({
    ...order,
    items: order.order_items ?? [],
  })) as Order[];
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<Order> {
  if (!orderId) {
    throw new Error("Order ID is required");
  }

  const allowedStatuses: OrderStatus[] = [
    "pending",
    "confirmed",
    "processing",
    "ready",
    "completed",
    "cancelled",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error("Invalid order status");
  }

  const admin = createAdminClient();

  const { data: currentOrder, error: currentOrderError } = await admin
    .from("orders")
    .select(`
      id,
      customer_id,
      order_number,
      status,
      subtotal,
      delivery_fee,
      discount,
      total_amount,
      currency,
      delivery_address,
      delivery_notes,
      created_at,
      updated_at
    `)
    .eq("id", orderId)
    .single();

  if (currentOrderError || !currentOrder) {
    throw new Error("Order not found");
  }

  const currentStatus = currentOrder.status as OrderStatus;

  const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["processing", "cancelled"],
    processing: ["ready", "cancelled"],
    ready: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  };

  if (!allowedTransitions[currentStatus].includes(status)) {
    throw new ApiError(
      `Cannot change order status from ${currentStatus} to ${status}`,
      400,
    );
  }

  // Cancellation must restore reserved stock atomically.
  if (status === "cancelled") {
    const { data: cancelledOrderId, error: cancelError } = await admin.rpc(
      "cancel_order",
      {
        p_order_id: orderId,
      },
    );

    if (cancelError || !cancelledOrderId) {
      throw new Error(
        cancelError?.message ?? "Failed to cancel order",
      );
    }
  } else {
    const { error: updateError } = await admin
      .from("orders")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateError) {
      throw new Error(
        updateError.message ?? "Failed to update order status",
      );
    }
  }

  const { data: updatedOrder, error: updatedOrderError } = await admin
    .from("orders")
    .select(`
      id,
      customer_id,
      order_number,
      status,
      subtotal,
      delivery_fee,
      discount,
      total_amount,
      currency,
      delivery_address,
      delivery_notes,
      created_at,
      updated_at,
      order_items (
        id,
        order_id,
        product_id,
        product_name,
        unit_price,
        quantity,
        subtotal,
        created_at
      )
    `)
    .eq("id", orderId)
    .single();

  if (updatedOrderError || !updatedOrder) {
    throw new Error(
      updatedOrderError?.message ?? "Failed to retrieve updated order",
    );
  }

    const finalOrder = {
    ...updatedOrder,
    items: updatedOrder.order_items ?? [],
  } as Order;

  if (status === "confirmed") {
    await createNotification({
      recipient_id: finalOrder.customer_id,
      notification_type: "order_confirmed",
      title: "Order confirmed",
      message: `Your order ${finalOrder.order_number} has been confirmed.`,
      channel: "in_app",
      related_entity_type: "order",
      related_entity_id: finalOrder.id,
    });
  }

  if (status === "processing") {
  await createNotification({
    recipient_id: finalOrder.customer_id,
    notification_type: "order_processing",
    title: "Order is being processed",
    message: `Your order ${finalOrder.order_number} is now being processed.`,
    channel: "in_app",
    related_entity_type: "order",
    related_entity_id: finalOrder.id,
  });
}

if (status === "ready") {
  await createNotification({
    recipient_id: finalOrder.customer_id,
    notification_type: "order_ready",
    title: "Order is ready",
    message: `Your order ${finalOrder.order_number} is ready.`,
    channel: "in_app",
    related_entity_type: "order",
    related_entity_id: finalOrder.id,
  });
}

if (status === "completed") {
  await createNotification({
    recipient_id: finalOrder.customer_id,
    notification_type: "order_completed",
    title: "Order completed",
    message: `Your order ${finalOrder.order_number} has been completed.`,
    channel: "in_app",
    related_entity_type: "order",
    related_entity_id: finalOrder.id,
  });
}

if (status === "cancelled") {
  await createNotification({
    recipient_id: finalOrder.customer_id,
    notification_type: "order_cancelled",
    title: "Order cancelled",
    message: `Your order ${finalOrder.order_number} has been cancelled.`,
    channel: "in_app",
    related_entity_type: "order",
    related_entity_id: finalOrder.id,
  });
}

  return finalOrder;
}