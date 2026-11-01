import { listPublicServiceCategories } from "@/features/services/service-category.service";
import { parseCatalogQuery } from "@/features/services/catalog.validation";
import { catalogResponse, catalogError } from "@/features/services/catalog.http";
export async function GET(request: Request) {
  try {
    const input = parseCatalogQuery(new URL(request.url).searchParams, true, true);
    return catalogResponse(await listPublicServiceCategories(input));
  } catch (error) { return catalogError(error); }
}
