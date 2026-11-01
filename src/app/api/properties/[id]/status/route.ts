import { changePropertyStatus } from "@/features/properties/property.service";
import { parsePropertyStatus, propertyId, noPropertyQuery } from "@/features/properties/property.validation";
import { propertyResponse, propertyError } from "@/features/properties/property.http";
import { requirePermission } from "@/server/auth/require-permission";
import { parseJson } from "@/server/http/parse-json";
type RouteContext = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requirePermission("properties.manage");
    noPropertyQuery(request);
    const id = propertyId((await context.params).id);
    const property = await changePropertyStatus(id, parsePropertyStatus(await parseJson<unknown>(request)), actor.user.id);
    return propertyResponse({ property, message: "Property status updated successfully" });
  } catch (error) { return propertyError(error); }
}
