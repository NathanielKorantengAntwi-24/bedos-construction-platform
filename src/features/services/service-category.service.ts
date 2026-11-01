import { catalogRpc, DEFAULT_CATALOG_QUERY, readCatalog, type Pagination } from "./catalog.service";
import { catalogId, type CatalogQuery } from "./catalog.validation";
import type { CreateServiceCategoryInput, ServiceCategory, UpdateServiceCategoryInput } from "./service-category.types";
export type PublicServiceCategory = Pick<ServiceCategory, "id" | "name" | "slug" | "description">;
export type CategoryList<T = ServiceCategory> = { categories: T[]; pagination: Pagination };
export async function listServiceCategories(actorId: string, input: CatalogQuery): Promise<CategoryList> {
  return await readCatalog("categories", actorId, input) as CategoryList;
}
export async function listPublicServiceCategories(input: CatalogQuery): Promise<CategoryList<PublicServiceCategory>> {
  return await readCatalog("categories", null, input) as CategoryList<PublicServiceCategory>;
}
export async function getServiceCategoryById(id: string, actorId: string): Promise<ServiceCategory> {
  return await readCatalog("categories", actorId, DEFAULT_CATALOG_QUERY, { id: catalogId(id) }) as ServiceCategory;
}
export async function createServiceCategory(input: CreateServiceCategoryInput, actorId: string): Promise<ServiceCategory> {
  return await catalogRpc("bedos_mutate_service_category", { p_actor_id: actorId, p_action: "create", p_id: null, p_input: input }) as ServiceCategory;
}
export async function updateServiceCategory(id: string, input: UpdateServiceCategoryInput, actorId: string): Promise<ServiceCategory> {
  return await catalogRpc("bedos_mutate_service_category", { p_actor_id: actorId, p_action: "update", p_id: catalogId(id), p_input: input }) as ServiceCategory;
}
export async function deleteServiceCategory(id: string, actorId: string): Promise<void> {
  await catalogRpc("bedos_mutate_service_category", { p_actor_id: actorId, p_action: "delete", p_id: catalogId(id), p_input: {} });
}
