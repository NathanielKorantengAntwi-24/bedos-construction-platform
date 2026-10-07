export type ViewingRequestStatus =
  | "new"
  | "contacted"
  | "in_progress"
  | "completed"
  | "cancelled";

export type ViewingRequest = {
  id: string;
  property_id: string;
  customer_id: string;
  preferred_date: string | null;
  preferred_time: string | null;
  message: string | null;
  status: ViewingRequestStatus;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateViewingRequestInput = {
  property_id: string;
  preferred_date?: string | null;
  preferred_time?: string | null;
  message?: string | null;
};

export type UpdateViewingRequestInput = {
  preferred_date?: string | null;
  preferred_time?: string | null;
  message?: string | null;
  status?: ViewingRequestStatus;
  assigned_to?: string | null;
};
