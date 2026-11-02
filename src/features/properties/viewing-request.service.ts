import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import { deliverViewingNotificationEvent } from "@/features/notifications/notification.service";
import type { CreateViewingRequestInput, UpdateViewingRequestInput, ViewingPage, ViewingQuery, ViewingRequest } from "./viewing-request.types";

type Json = Record<string, unknown>;
function viewingFailure(code: string): never {
  if (code === "42501") throw new ApiError("Forbidden", 403);
  if (code.startsWith("22") || code === "23514") throw new ApiError("Invalid viewing request.", 400);
  if (code === "P0002") throw new ApiError("Viewing request or property not found.", 404);
  if (code === "P0409") throw new ApiError("Property is no longer available for this request", 409);
  if (["P0001", "23503", "23505", "55P03", "40P01", "40001"].includes(code)) throw new ApiError("Viewing changed, is busy or cannot accept this operation.", 409);
  throw new ApiError("Unable to complete viewing request.", 503);
}
async function viewingRpc<T>(name: string, args: Json): Promise<T> {
  try {
    const client = createAdminClient((input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }));
    const { data, error } = await client.rpc(name, args);
    if (error) { console.error("Viewing database operation rejected", { operation: name, code: error.code }); viewingFailure(error.code); }
    if (data === null || data === undefined) viewingFailure("UNAVAILABLE");
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Unable to complete viewing request.", 503);
  }
}
export async function listViewingRequests(actor: string, query: ViewingQuery, propertyList = false) {
  return viewingRpc<ViewingPage>("bedos_read_viewings", { p_actor: actor, p_property: query.property_id ?? null, p_status: query.status ?? null, p_customer: query.customer_id ?? null, p_assigned: query.assigned_to ?? null, p_page: query.page, p_limit: query.limit, p_property_list: propertyList });
}
export async function getViewingRequest(property: string, id: string, actor: string) {
  return viewingRpc<ViewingRequest>("bedos_read_viewings", { p_actor: actor, p_property: property, p_id: id });
}
async function mutation(actor: string, action: string, property: string, id: string | null, input: Json, version: number | null) {
  const result = await viewingRpc<{ record: ViewingRequest; notification_events: string[] }>("bedos_mutate_viewing", { p_actor: actor, p_action: action, p_property: property, p_id: id, p_input: input, p_expected_version: version });
  // Bounded post-commit work. Any failure or remaining fanout stays in the durable queue.
  const immediate = result.notification_events.slice(0, 10);
  const delivered = await Promise.all(immediate.map(event => deliverViewingNotificationEvent(actor, event)));
  return { data: result.record, ...(result.notification_events.length > immediate.length || delivered.some(r => r.errorCode || r.event?.state === "pending" || r.event?.state === "processing") ? { notifications_pending: true } : {}) };
}
export function createViewingRequest(input: CreateViewingRequestInput, actor: string) {
  const { property_id, ...fields } = input;
  return mutation(actor, "create", property_id, null, fields, null);
}
export function updateViewingRequest(property: string, id: string, input: UpdateViewingRequestInput, actor: string) {
  const { expected_version, ...fields } = input;
  return mutation(actor, "update", property, id, fields, expected_version);
}
export function deleteViewingRequest(property: string, id: string, actor: string, version: number) {
  return mutation(actor, "delete", property, id, {}, version);
}
export function listViewingNotificationEvents(actor: string, page: number, limit: number) {
  return viewingRpc<Json>("bedos_viewing_events", { p_actor: actor, p_page: page, p_limit: limit });
}
export async function retryViewingNotificationEvent(actor: string, event: string) {
  const result = await deliverViewingNotificationEvent(actor, event, true);
  if (result.errorCode) viewingFailure(result.errorCode);
  if (!result.event) viewingFailure("UNAVAILABLE");
  return result.event;
}
