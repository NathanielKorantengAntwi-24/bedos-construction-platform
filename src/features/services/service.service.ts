import { catalogRpc, DEFAULT_CATALOG_QUERY, readCatalog, type Pagination } from "./catalog.service";
import { catalogId, publicServiceSlug, type CatalogQuery } from "./catalog.validation";
import type { CreateServiceInput, Service, UpdateServiceInput } from "./service.types";
export type PublicService = Pick<Service, "id" | "category_id" | "name" | "slug" | "description" | "featured">;
export type ServiceList<T = Service> = { services: T[]; pagination: Pagination };
export async function listServices(actorId: string, input: CatalogQuery): Promise<ServiceList> {
  return await readCatalog("services", actorId, input) as ServiceList;
}
export async function getServiceById(serviceId: string, actorId: string): Promise<Service> {
  return await readCatalog("services", actorId, DEFAULT_CATALOG_QUERY, { id: catalogId(serviceId) }) as Service;
}
export async function listPublicServices(input: CatalogQuery): Promise<ServiceList<PublicService>> {
  return await readCatalog("services", null, input) as ServiceList<PublicService>;
}
export async function getPublicServiceBySlug(slug: string): Promise<PublicService> {
  return await readCatalog("services", null, DEFAULT_CATALOG_QUERY, { slug: publicServiceSlug(slug) }) as PublicService;
}
export async function createService(input: CreateServiceInput, createdBy: string): Promise<Service> {
  return await catalogRpc("bedos_mutate_service", { p_actor_id: createdBy, p_action: "create", p_id: null, p_input: input }) as Service;
}
export async function updateService(serviceId: string, input: UpdateServiceInput, actorId: string): Promise<Service> {
  return await catalogRpc("bedos_mutate_service", { p_actor_id: actorId, p_action: "update", p_id: catalogId(serviceId), p_input: input }) as Service;
}
export async function deleteService(serviceId: string, actorId: string): Promise<void> {
  await catalogRpc("bedos_mutate_service", { p_actor_id: actorId, p_action: "delete", p_id: catalogId(serviceId), p_input: {} });
}
