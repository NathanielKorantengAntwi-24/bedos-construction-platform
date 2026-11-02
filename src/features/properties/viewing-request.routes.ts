import { ApiError } from "@/server/http/api-error";
import { getUserContext } from "@/server/auth/get-user-context";
import { requirePermission } from "@/server/auth/require-permission";
import { propertyResponse as response, propertyError as failure } from "./property.http";
import { noPropertyQuery } from "./property.validation";
import { createViewingRequest, deleteViewingRequest, getViewingRequest, listViewingNotificationEvents, listViewingRequests, retryViewingNotificationEvent, updateViewingRequest } from "./viewing-request.service";
import { parseViewingInput, parseViewingQuery, viewingDeleteQuery, viewingId, viewingJson, viewingObject } from "./viewing-request.validation";

type Context = { params: Promise<{ id: string; viewingRequestId?: string }> };
async function actor(mode: "read" | "write" | "staff" | "customer" | "admin") {
  const context = await getUserContext();
  if (!context) throw new ApiError("Unauthorized", 401);
  if (context.profile.account_status !== "active") throw new ApiError("Account is not active", 403);
  const role = context.role?.name, staff = role === "administrator" || role === "sales_customer_service";
  if ((!staff && role !== "customer") || (mode === "customer" && role !== "customer") || (mode === "admin" && role !== "administrator") || (mode === "staff" && !staff)) throw new ApiError("Forbidden", 403);
  if (staff) await requirePermission(mode === "read" || mode === "staff" ? "viewings.view" : "viewings.manage");
  return { id: context.user.id, staff };
}
export async function viewingList(request: Request) {
  try {
    const user = await actor("read"), query = parseViewingQuery(new URL(request.url).searchParams, user.staff);
    return response(await listViewingRequests(user.id, query));
  } catch (error) { return failure(error); }
}
export async function viewingCollectionGet(request: Request, context: Context) {
  try {
    const user = await actor("staff"), property = viewingId((await context.params).id);
    const query = parseViewingQuery(new URL(request.url).searchParams, true, true);
    return response(await listViewingRequests(user.id, { ...query, property_id: property }, true));
  } catch (error) { return failure(error); }
}
export async function viewingCollectionPost(request: Request, context: Context) {
  try {
    const user = await actor("customer"); noPropertyQuery(request);
    const property = viewingId((await context.params).id), fields = parseViewingInput(await viewingJson(request), true);
    return response(await createViewingRequest({ ...fields, property_id: property }, user.id), 201);
  } catch (error) { return failure(error); }
}
export async function viewingItemGet(request: Request, context: Context) {
  try {
    const user = await actor("read"); noPropertyQuery(request);
    const params = await context.params;
    return response({ data: await getViewingRequest(viewingId(params.id), viewingId(params.viewingRequestId), user.id) });
  } catch (error) { return failure(error); }
}
export async function viewingItemPatch(request: Request, context: Context) {
  try {
    const user = await actor("write"); noPropertyQuery(request);
    const params = await context.params, property = viewingId(params.id), id = viewingId(params.viewingRequestId);
    const input = parseViewingInput(await viewingJson(request), false);
    return response(await updateViewingRequest(property, id, input, user.id));
  } catch (error) { return failure(error); }
}
export async function viewingItemDelete(request: Request, context: Context) {
  try {
    const user = await actor("admin"), params = await context.params;
    const property = viewingId(params.id), id = viewingId(params.viewingRequestId), version = viewingDeleteQuery(new URL(request.url).searchParams);
    await deleteViewingRequest(property, id, user.id, version);
    return response({ message: "Viewing request deleted successfully" });
  } catch (error) { return failure(error); }
}
export async function viewingEventsGet(request: Request) {
  try {
    const user = await actor("admin"), query = parseViewingQuery(new URL(request.url).searchParams, true, false, true);
    return response(await listViewingNotificationEvents(user.id, query.page, query.limit));
  } catch (error) { return failure(error); }
}
export async function viewingEventRetry(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const user = await actor("admin"); noPropertyQuery(request);
    const id = viewingId((await context.params).eventId), input = viewingObject(await viewingJson(request, true));
    if (Object.keys(input).length) throw new ApiError("Retry accepts no viewing event fields.", 400);
    const event = await retryViewingNotificationEvent(user.id, id);
    return response(event, event.state === "pending" || event.state === "processing" ? 202 : 200);
  } catch (error) { return failure(error); }
}
