import { requirePermission } from "@/server/auth/require-permission";
import { mediaRpc } from "@/features/properties/media.service";
import { mediaPage } from "@/features/properties/media.validation";
import { propertyResponse, propertyError } from "@/features/properties/property.http";
export async function GET(request: Request) {
  try {
    const actor = await requirePermission("properties.manage"), page = mediaPage(new URL(request.url).searchParams);
    return propertyResponse(await mediaRpc("bedos_media_operation", { p_actor: actor.user.id, p_action: "list", p_page: page.page, p_limit: page.limit }));
  } catch (error) { return propertyError(error); }
}
