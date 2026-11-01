import { listServiceCategories, createServiceCategory } from "@/features/services/service-category.service";
import { parseCatalogInput, parseCatalogQuery } from "@/features/services/catalog.validation";
import { catalogResponse, catalogError } from "@/features/services/catalog.http";
import { requirePermission } from "@/server/auth/require-permission";
import { parseJson } from "@/server/http/parse-json";

export async function GET(request: Request) {
  try {
    const actor = await requirePermission("services.view");
    const input = parseCatalogQuery(new URL(request.url).searchParams, true);
    return catalogResponse(await listServiceCategories(actor.user.id, input));
  } catch (error) { return catalogError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await requirePermission("services.manage");
    const input = parseCatalogInput(await parseJson<unknown>(request), true, true);
    const category = await createServiceCategory(input, actor.user.id);
    return catalogResponse({ category, message: "Service category created successfully" }, 201);
  } catch (error) { return catalogError(error); }
}
