export type EnquiryType =
  | "property_enquiry"
  | "quote_request"
  | "construction_request"
  | "maintenance_request"
  | "painting_request"
  | "tiling_request"
  | "interior_design_request"
  | "product_enquiry"
  | "general_contact";

export type EnquiryStatus =
  | "new"
  | "contacted"
  | "in_progress"
  | "completed";

export type Enquiry = {
  id: string;
  customer_id: string | null;
  enquiry_type: EnquiryType;
  subject: string | null;
  message: string | null;
  property_id: string | null;
  product_id: string | null;
  service_id: string | null;
  status: EnquiryStatus;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateEnquiryInput = {
  enquiry_type: EnquiryType;
  subject?: string | null;
  message?: string | null;
  property_id?: string | null;
  product_id?: string | null;
  service_id?: string | null;
};

export type UpdateEnquiryInput = {
  subject?: string | null;
  message?: string | null;
  status?: EnquiryStatus;
  assigned_to?: string | null;
};
