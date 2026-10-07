import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import type {
  CreateProductInput,
  Product,
  UpdateProductInput,
} from "./product.types";

const PRODUCT_SELECT = `
  id,
  category_id,
  name,
  slug,
  description,
  price,
  currency,
  stock_quantity,
  status,
  featured,
  created_by,
  created_at,
  updated_at
`;

export async function listProducts(): Promise<Product[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return (data ?? []) as Product[];
}

export async function getProductById(
  productId: string,
): Promise<Product> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", productId)
    .single();

  if (error || !data) {
    throw new ApiError("Product not found", 404);
  }

  return data as Product;
}

export async function createProduct(
  input: CreateProductInput,
  createdBy: string,
): Promise<Product> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("products")
    .insert({
      category_id: input.category_id ?? null,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      price: input.price,
      currency: input.currency ?? "GHS",
      stock_quantity: input.stock_quantity ?? 0,
      status: input.status ?? "draft",
      featured: input.featured ?? false,
      created_by: createdBy,
    })
    .select(PRODUCT_SELECT)
    .single();

  if (error || !data) {
    throw new ApiError(
      error?.message ?? "Failed to create product",
      500,
    );
  }

  return data as Product;
}

export async function updateProduct(
  productId: string,
  input: UpdateProductInput,
): Promise<Product> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("products")
    .update({
      ...(input.category_id !== undefined && {
        category_id: input.category_id,
      }),
      ...(input.name !== undefined && {
        name: input.name,
      }),
      ...(input.slug !== undefined && {
        slug: input.slug,
      }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.price !== undefined && {
        price: input.price,
      }),
      ...(input.currency !== undefined && {
        currency: input.currency,
      }),
      ...(input.stock_quantity !== undefined && {
        stock_quantity: input.stock_quantity,
      }),
      ...(input.status !== undefined && {
        status: input.status,
      }),
      ...(input.featured !== undefined && {
        featured: input.featured,
      }),
    })
    .eq("id", productId)
    .select(PRODUCT_SELECT)
    .single();

  if (error || !data) {
    throw new ApiError(
      error?.message ?? "Product not found",
      error?.code === "PGRST116" ? 404 : 500,
    );
  }

  return data as Product;
}

export async function deleteProduct(
  productId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId);

  if (error) {
    throw new ApiError(error.message, 500);
  }
}
