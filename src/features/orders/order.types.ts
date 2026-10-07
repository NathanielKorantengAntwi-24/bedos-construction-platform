export type OrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "ready"
  | "completed"
  | "cancelled";

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  created_at: string;
};

export type Order = {
  id: string;
  customer_id: string;
  order_number: string;
  status: OrderStatus;
  subtotal: number;
  delivery_fee: number;
  discount: number;
  total_amount: number;
  currency: string;
  delivery_address: string | null;
  delivery_notes: string | null;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
};

export type CreateOrderItemInput = {
  product_id: string;
  quantity: number;
};

export type CreateOrderInput = {
  items: CreateOrderItemInput[];
  delivery_address?: string | null;
  delivery_notes?: string | null;
};

export type UpdateOrderInput = {
  status?: OrderStatus;
  delivery_address?: string | null;
  delivery_notes?: string | null;
};
