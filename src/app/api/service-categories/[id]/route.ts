import { getServiceCategoryById, updateServiceCategory, deleteServiceCategory } from "@/features/services/service-category.service";
import { catalogId, noDetailQuery, parseCatalogInput } from "@/features/services/catalog.validation";
import { catalogResponse, catalogError } from "@/features/services/catalog.http";
import { requirePermission } from "@/server/auth/require-permission";
import { parseJson } from "@/server/http/parse-json";
type RouteContext = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requirePermission("services.view");
    const id = catalogId((await context.params).id);
    noDetailQuery(request);
    return catalogResponse({ category: await getServiceCategoryById(id, actor.user.id) });
  } catch (error) { return catalogError(error); }
}
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requirePermission("services.manage");
    const id = catalogId((await context.params).id);
    noDetailQuery(request);
    const input = parseCatalogInput(await parseJson<unknown>(request), true, false);
    return catalogResponse({ category: await updateServiceCategory(id, input, actor.user.id), message: "Service category updated successfully" });
  } catch (error) { return catalogError(error); }
}
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const actor = await requirePermission("services.manage");
    const id = catalogId((await context.params).id);
    noDetailQuery(request);
    await deleteServiceCategory(id, actor.user.id);
    return catalogResponse({ message: "Service category deleted successfully" });
  } catch (error) { return catalogError(error); }
}
