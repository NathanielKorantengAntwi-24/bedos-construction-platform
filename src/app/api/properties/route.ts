import { createProperty, listPublishedProperties } from "@/features/properties/property.service";
import { parsePropertyInput, parsePropertyQuery, noPropertyQuery } from "@/features/properties/property.validation";
import { propertyResponse, propertyError } from "@/features/properties/property.http";
import { requirePermission } from "@/server/auth/require-permission";
import { parseJson } from "@/server/http/parse-json";
export async function GET(request: Request) {
  try { return propertyResponse(await listPublishedProperties(parsePropertyQuery(new URL(request.url).searchParams))); }
  catch (error) { return propertyError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await requirePermission("properties.manage");
    noPropertyQuery(request);
    const property = await createProperty(parsePropertyInput(await parseJson<unknown>(request), true), actor.user.id);
    return propertyResponse({ property, message: "Property created successfully" }, 201);
  } catch (error) { return propertyError(error); }
}
