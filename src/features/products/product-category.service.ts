import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import type {
  CreateProductCategoryInput,
  ProductCategory,
  UpdateProductCategoryInput,
} from "./product-category.types";

const CATEGORY_SELECT = `
  id,
  name,
  slug,
  description,
  created_at,
  updated_at
`;

export async function listProductCategories(): Promise<ProductCategory[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("product_categories")
    .select(CATEGORY_SELECT)
    .order("name", { ascending: true });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return (data ?? []) as ProductCategory[];
}

export async function getProductCategoryById(
  categoryId: string,
): Promise<ProductCategory> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("product_categories")
    .select(CATEGORY_SELECT)
    .eq("id", categoryId)
    .single();

  if (error || !data) {
    throw new ApiError("Product category not found", 404);
  }

  return data as ProductCategory;
}

export async function createProductCategory(
  input: CreateProductCategoryInput,
): Promise<ProductCategory> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("product_categories")
    .insert({
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
    })
    .select(CATEGORY_SELECT)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ApiError(
        "A product category with this name or slug already exists",
        409,
      );
    }

    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError("Failed to create product category", 500);
  }

  return data as ProductCategory;
}

export async function updateProductCategory(
  categoryId: string,
  input: UpdateProductCategoryInput,
): Promise<ProductCategory> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("product_categories")
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.slug !== undefined && { slug: input.slug }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
    })
    .eq("id", categoryId)
    .select(CATEGORY_SELECT)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ApiError(
        "A product category with this name or slug already exists",
        409,
      );
    }

    if (error.code === "PGRST116") {
      throw new ApiError("Product category not found", 404);
    }

    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError("Product category not found", 404);
  }

  return data as ProductCategory;
}

export async function deleteProductCategory(
  categoryId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("product_categories")
    .delete()
    .eq("id", categoryId);

  if (error) {
    throw new ApiError(error.message, 500);
  }
}
