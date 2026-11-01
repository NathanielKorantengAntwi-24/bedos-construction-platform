import { listManagedProperties } from "@/features/properties/property.service";
import { parsePropertyQuery } from "@/features/properties/property.validation";
import { propertyResponse, propertyError } from "@/features/properties/property.http";
import { requirePermission } from "@/server/auth/require-permission";
export async function GET(request: Request) {
  try {
    const actor = await requirePermission("properties.manage");
    return propertyResponse(await listManagedProperties(parsePropertyQuery(new URL(request.url).searchParams, true), actor.user.id));
  } catch (error) { return propertyError(error); }
}
