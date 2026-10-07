import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import type {
  CreateServiceInput,
  Service,
  UpdateServiceInput,
} from "./service.types";

const SERVICE_SELECT = `
  id,
  category_id,
  name,
  slug,
  description,
  status,
  featured,
  created_by,
  created_at,
  updated_at
`;

export async function listServices(): Promise<Service[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("services")
    .select(SERVICE_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return (data ?? []) as Service[];
}

export async function getServiceById(
  serviceId: string,
): Promise<Service> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("services")
    .select(SERVICE_SELECT)
    .eq("id", serviceId)
    .single();

  if (error || !data) {
    throw new ApiError("Service not found", 404);
  }

  return data as Service;
}

export async function createService(
  input: CreateServiceInput,
  createdBy: string,
): Promise<Service> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("services")
    .insert({
      category_id: input.category_id ?? null,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      status: input.status ?? "draft",
      featured: input.featured ?? false,
      created_by: createdBy,
    })
    .select(SERVICE_SELECT)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ApiError(
        "A service with this slug already exists",
        409,
      );
    }

    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError("Failed to create service", 500);
  }

  return data as Service;
}

export async function updateService(
  serviceId: string,
  input: UpdateServiceInput,
): Promise<Service> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("services")
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
      ...(input.status !== undefined && {
        status: input.status,
      }),
      ...(input.featured !== undefined && {
        featured: input.featured,
      }),
    })
    .eq("id", serviceId)
    .select(SERVICE_SELECT)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ApiError(
        "A service with this slug already exists",
        409,
      );
    }

    if (error.code === "PGRST116") {
      throw new ApiError("Service not found", 404);
    }

    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError("Service not found", 404);
  }

  return data as Service;
}

export async function deleteService(
  serviceId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("services")
    .delete()
    .eq("id", serviceId);

  if (error) {
    throw new ApiError(error.message, 500);
  }
}