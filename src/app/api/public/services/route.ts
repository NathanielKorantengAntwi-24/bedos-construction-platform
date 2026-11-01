import { listPublicServices } from "@/features/services/service.service";
import { parseCatalogQuery } from "@/features/services/catalog.validation";
import { catalogResponse, catalogError } from "@/features/services/catalog.http";
export async function GET(request: Request) {
  try {
    const input = parseCatalogQuery(new URL(request.url).searchParams, false, true);
    return catalogResponse(await listPublicServices(input));
  } catch (error) { return catalogError(error); }
}
