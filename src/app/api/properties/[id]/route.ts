import { deleteProperty, getPropertyById, updateProperty } from "@/features/properties/property.service";
import { parsePropertyInput, propertyId, noPropertyQuery } from "@/features/properties/property.validation";
import { propertyResponse, propertyError } from "@/features/properties/property.http";
import { requirePermission } from "@/server/auth/require-permission";
import { getUserContext } from "@/server/auth/get-user-context";
import { parseJson } from "@/server/http/parse-json";
type RouteContext = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: RouteContext) {
  try {
    noPropertyQuery(request);
    const id = propertyId((await context.params).id);
    const actor = await getUserContext();
    const canPreview = actor?.profile.account_status === "active" && ["administrator", "content_manager"].includes(actor.role?.name ?? "");
    return propertyResponse({ property: await getPropertyById(id, canPreview ? actor!.user.id : null) });
  } catch (error) { return propertyError(error); }
}
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requirePermission("properties.manage");
    noPropertyQuery(request);
    const id = propertyId((await context.params).id);
    const property = await updateProperty(id, parsePropertyInput(await parseJson<unknown>(request), false), actor.user.id);
    return propertyResponse({ property, message: "Property updated successfully" });
  } catch (error) { return propertyError(error); }
}
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requirePermission("properties.manage");
    noPropertyQuery(request);
    const id = propertyId((await context.params).id);
    await deleteProperty(id, actor.user.id);
    return propertyResponse({ property_id: id, message: "Property deleted successfully" });
  } catch (error) { return propertyError(error); }
}
