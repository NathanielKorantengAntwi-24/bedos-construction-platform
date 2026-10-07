export type ProductCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateProductCategoryInput = {
  name: string;
  slug: string;
  description?: string | null;
};

export type UpdateProductCategoryInput = {
  name?: string;
  slug?: string;
  description?: string | null;
};
