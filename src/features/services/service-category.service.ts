import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import type {
  CreateServiceCategoryInput,
  ServiceCategory,
  UpdateServiceCategoryInput,
} from "./service-category.types";

const CATEGORY_SELECT = `
  id,
  name,
  slug,
  description,
  created_at,
  updated_at
`;

export async function listServiceCategories(): Promise<ServiceCategory[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("service_categories")
    .select(CATEGORY_SELECT)
    .order("name", { ascending: true });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return (data ?? []) as ServiceCategory[];
}

export async function getServiceCategoryById(
  categoryId: string,
): Promise<ServiceCategory> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("service_categories")
    .select(CATEGORY_SELECT)
    .eq("id", categoryId)
    .single();

  if (error || !data) {
    throw new ApiError("Service category not found", 404);
  }

  return data as ServiceCategory;
}

export async function createServiceCategory(
  input: CreateServiceCategoryInput,
): Promise<ServiceCategory> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("service_categories")
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
        "A service category with this name or slug already exists",
        409,
      );
    }

    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError("Failed to create service category", 500);
  }

  return data as ServiceCategory;
}

export async function updateServiceCategory(
  categoryId: string,
  input: UpdateServiceCategoryInput,
): Promise<ServiceCategory> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("service_categories")
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
        "A service category with this name or slug already exists",
        409,
      );
    }

    if (error.code === "PGRST116") {
      throw new ApiError("Service category not found", 404);
    }

    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError("Service category not found", 404);
  }

  return data as ServiceCategory;
}

export async function deleteServiceCategory(
  categoryId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("service_categories")
    .delete()
    .eq("id", categoryId);

  if (error) {
    throw new ApiError(error.message, 500);
  }
}