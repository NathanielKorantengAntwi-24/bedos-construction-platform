import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import type { CreatePropertyInput, Property, PropertyListFilters, UpdatePropertyInput } from "./property.types";
import { propertyId, type PropertyStatusInput } from "./property.validation";
export type PublicProperty = Omit<Property, "created_by">;
export type PropertyList = { properties: (Property | PublicProperty)[]; pagination: { page: number; limit: number; total: number; total_pages: number } };
export async function propertyRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await createAdminClient().rpc(name, args);
    if (error) {
      if (error.code === "42501") throw new ApiError("Forbidden", 403);
      if (["22023", "22P02", "22003", "23514"].includes(error.code)) throw new ApiError("Invalid property request.", 400);
      if (error.code === "P0002") throw new ApiError("Property not found", 404);
      if (["23505", "23503", "P0001"].includes(error.code)) throw new ApiError("Property changed, already exists or is in use.", 409);
      console.error("Property operation failed", { operation: name, code: error.code });
      throw new ApiError("Unable to complete property request.", 500);
    }
    if (data === null || data === undefined) throw new ApiError("Unable to complete property request.", 500);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Property operation unavailable", { operation: name });
    throw new ApiError("Unable to complete property request.", 500);
  }
}
function readProperties(filters: PropertyListFilters, actorId: string | null, id: string | null = null) {
  return propertyRpc("bedos_read_properties", { p_actor_id: actorId, p_id: id, p_filters: filters });
}
export async function listPublishedProperties(filters: PropertyListFilters): Promise<PropertyList> { return await readProperties(filters, null) as PropertyList; }
export async function listManagedProperties(filters: PropertyListFilters, actorId: string): Promise<PropertyList> { return await readProperties(filters, actorId) as PropertyList; }
export async function getPropertyById(id: string, actorId: string | null = null): Promise<Property | PublicProperty> {
  return await readProperties({}, actorId, propertyId(id)) as Property | PublicProperty;
}
function mutate(action: string, actorId: string, id: string | null, input: unknown) {
  return propertyRpc("bedos_mutate_property", { p_actor_id: actorId, p_action: action, p_id: id, p_input: input });
}
export async function createProperty(input: CreatePropertyInput, userId: string): Promise<Property> { return await mutate("create", userId, null, input) as Property; }
export async function updateProperty(id: string, input: UpdatePropertyInput, actorId: string): Promise<Property> { return await mutate("update", actorId, propertyId(id), input) as Property; }
export async function changePropertyStatus(id: string, input: PropertyStatusInput, actorId: string): Promise<Property> { return await mutate("status", actorId, propertyId(id), input) as Property; }
export async function deleteProperty(id: string, actorId: string): Promise<void> { await mutate("delete", actorId, propertyId(id), {}); }
