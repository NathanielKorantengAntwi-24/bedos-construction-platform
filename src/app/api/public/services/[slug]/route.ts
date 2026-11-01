import { getPublicServiceBySlug } from "@/features/services/service.service";
import { noDetailQuery, publicServiceSlug } from "@/features/services/catalog.validation";
import { catalogResponse, catalogError } from "@/features/services/catalog.http";
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    noDetailQuery(request);
    return catalogResponse({ service: await getPublicServiceBySlug(publicServiceSlug((await context.params).slug)) });
  } catch (error) { return catalogError(error); }
}
