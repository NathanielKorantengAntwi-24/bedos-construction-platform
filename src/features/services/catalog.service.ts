import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import type { CatalogQuery } from "./catalog.validation";
export type Pagination = { page: number; page_size: number; total: number };
export async function catalogRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await createAdminClient().rpc(name, args);
    if (error) {
      if (error.code === "42501") throw new ApiError("Forbidden", 403);
      if (error.code === "22023" || error.code === "22P02") throw new ApiError("Invalid catalog request.", 400);
      if (error.code === "P0002") throw new ApiError("Catalog record not found", 404);
      if (error.code === "23505") throw new ApiError("A catalog record with this name or slug already exists", 409);
      if (error.code === "23503" || error.code === "P0001") throw new ApiError("Catalog record changed or is in use. Please retry.", 409);
      console.error("Catalog operation failed", { operation: name, code: error.code });
      throw new ApiError("Unable to complete catalog request.", 500);
    }
    if (data === null || data === undefined) throw new ApiError("Unable to complete catalog request.", 500);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Catalog operation unavailable", { operation: name });
    throw new ApiError("Unable to complete catalog request.", 500);
  }
}
export function readCatalog(entity: "services" | "categories", actorId: string | null, input: CatalogQuery, detail: { id?: string; slug?: string } = {}) {
  return catalogRpc("bedos_read_service_catalog", {
    p_actor_id: actorId, p_public: actorId === null, p_entity: entity,
    p_id: detail.id ?? null, p_slug: detail.slug ?? null,
    p_page: input.page, p_page_size: input.page_size, p_q: input.q,
    p_category_id: input.category_id, p_featured: input.featured, p_status: input.status,
  });
}
export const DEFAULT_CATALOG_QUERY: CatalogQuery = { page: 1, page_size: 25, q: null, category_id: null, featured: null, status: null };
