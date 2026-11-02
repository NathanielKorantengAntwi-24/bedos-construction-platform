export type ViewingRequestStatus = "new" | "contacted" | "scheduled" | "completed" | "cancelled";
export type ViewingRequest = {
  id: string; property_id: string; customer_id: string; preferred_date: string | null;
  preferred_time: string | null; message: string | null; status: ViewingRequestStatus;
  assigned_to: string | null; created_at: string; updated_at: string; version: number;
};
export type CreateViewingRequestFields = { preferred_date?: string | null; preferred_time?: string | null; message?: string | null };
export type CreateViewingRequestInput = CreateViewingRequestFields & { property_id: string };
export type UpdateViewingRequestInput = CreateViewingRequestFields & { status?: ViewingRequestStatus; assigned_to?: string | null; expected_version: number };
export type ViewingQuery = { page: number; limit: number; status?: ViewingRequestStatus; property_id?: string; customer_id?: string; assigned_to?: string };
export type ViewingPage = { data: ViewingRequest[]; pagination: { page: number; limit: number; total: number } };
