export type ProductStatus =
  | "draft"
  | "published"
  | "out_of_stock"
  | "archived";

export type Product = {
  id: string;
  category_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  stock_quantity: number;
  status: ProductStatus;
  featured: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateProductInput = {
  category_id?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  price: number;
  currency?: string;
  stock_quantity?: number;
  status?: ProductStatus;
  featured?: boolean;
};

export type UpdateProductInput = {
  category_id?: string | null;
  name?: string;
  slug?: string;
  description?: string | null;
  price?: number;
  currency?: string;
  stock_quantity?: number;
  status?: ProductStatus;
  featured?: boolean;
};
