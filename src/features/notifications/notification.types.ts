export type NotificationChannel =
  | "in_app"
  | "email"
  | "whatsapp";

export type NotificationStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "failed"
  | "read";

export type NotificationType =
  | "viewing_created"
  | "viewing_updated"
  | "viewing_assigned"
  | "viewing_scheduled"
  | "enquiry_created"
  | "enquiry_updated"
  | "order_created"
  | "order_confirmed"
  | "order_processing"
  | "order_ready"
  | "order_completed"
  | "order_cancelled";

export type Notification = {
  id: string;
  recipient_id: string;
  notification_type: NotificationType;
  title: string;
  message: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  related_entity_type: string | null;
  related_entity_id: string | null;
  sent_at: string | null;
  read_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type CreateNotificationInput = {
  recipient_id: string;
  notification_type: NotificationType;
  title: string;
  message: string;
  channel?: NotificationChannel;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  metadata?: Record<string, unknown> | null;
};
