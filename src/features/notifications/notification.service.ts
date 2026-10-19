import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CreateNotificationInput,
  Notification,
} from "./notification.types";

const NOTIFICATION_SELECT = `
  id,
  recipient_id,
  notification_type,
  title,
  message,
  channel,
  status,
  related_entity_type,
  related_entity_id,
  sent_at,
  read_at,
  metadata,
  created_at,
  updated_at
`;

export async function createNotification(
  input: CreateNotificationInput
): Promise<Notification> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      recipient_id: input.recipient_id,
      notification_type: input.notification_type,
      title: input.title,
      message: input.message,
      channel: input.channel ?? "in_app",
      status: "pending",
      related_entity_type: input.related_entity_type ?? null,
      related_entity_id: input.related_entity_id ?? null,
      metadata: input.metadata ?? null,
    })
    .select(NOTIFICATION_SELECT)
    .single();

  if (error) {
    const isDuplicateOrderConfirmation =
      error.code === "23505" &&
      error.message.includes(
        "notifications_one_order_confirmed_per_order"
      ) &&
      input.notification_type === "order_confirmed" &&
      input.related_entity_type === "order" &&
      Boolean(input.related_entity_id);

    if (isDuplicateOrderConfirmation) {
      const { data: existing, error: lookupError } = await supabase
        .from("notifications")
        .select(NOTIFICATION_SELECT)
        .eq("recipient_id", input.recipient_id)
        .eq("notification_type", "order_confirmed")
        .eq("related_entity_type", "order")
        .eq("related_entity_id", input.related_entity_id)
        .maybeSingle();

      if (lookupError || !existing) {
        throw new Error(
          lookupError?.message ??
            "Existing order confirmation notification could not be loaded"
        );
      }

      return existing as Notification;
    }

    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Failed to create notification");
  }

  return data as Notification;
}

export async function listUserNotifications(
  recipientId: string
): Promise<Notification[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_SELECT)
    .eq("recipient_id", recipientId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      error.message ?? "Failed to load notifications"
    );
  }

  return (data ?? []) as Notification[];
}

export async function markNotificationAsRead(
  notificationId: string,
  recipientId: string
): Promise<Notification> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("notifications")
    .update({
      status: "read",
      read_at: new Date().toISOString(),
    })
    .eq("id", notificationId)
    .eq("recipient_id", recipientId)
    .select(NOTIFICATION_SELECT)
    .single();

  if (error || !data) {
    throw new Error(
      error?.message ?? "Notification not found"
    );
  }

  return data as Notification;
}
