export type ServiceStatus =
  | "draft"
  | "published"
  | "archived";

export type Service = {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: ServiceStatus;
  featured: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateServiceInput = {
  category_id?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  status?: ServiceStatus;
  featured?: boolean;
};

export type UpdateServiceInput = {
  category_id?: string | null;
  name?: string;
  slug?: string;
  description?: string | null;
  status?: ServiceStatus;
  featured?: boolean;
};