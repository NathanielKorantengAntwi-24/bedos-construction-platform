export type ServiceCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateServiceCategoryInput = {
  name: string;
  slug: string;
  description?: string | null;
};

export type UpdateServiceCategoryInput = {
  name?: string;
  slug?: string;
  description?: string | null;
};