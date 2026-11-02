import { getUserContext } from "@/server/auth/get-user-context";
import { requirePermission } from "@/server/auth/require-permission";
import { parseJson } from "@/server/http/parse-json";
import { propertyError, propertyResponse } from "./property.http";
import { propertyId, noPropertyQuery } from "./property.validation";
import { mediaForm, mediaInput, mediaPage } from "./media.validation";
import { mediaFile, type propertyMediaService } from "./media.service";

type Service = ReturnType<typeof propertyMediaService>;
type Context = { params: Promise<Record<string, string>> };
const keys = { images: ["images", "image", "imageId"], floor_plans: ["floorPlans", "floorPlan", "floorPlanId"], features: ["features", "feature", "featureId"], amenities: ["amenities", "amenity", "amenityId"] } as const;
async function previewActor() {
  const actor = await getUserContext();
  return actor?.profile.account_status === "active" && ["administrator", "content_manager"].includes(actor.role?.name ?? "") ? actor.user.id : null;
}
export function mediaCollection(service: Service) {
  return {
    async GET(request: Request, context: Context) {
      try {
        const id = propertyId((await context.params).id), page = mediaPage(new URL(request.url).searchParams);
        const result = await service.list(id, await previewActor(), page.page, page.limit);
        return propertyResponse({ [keys[service.kind][0]]: result.records, pagination: result.pagination });
      } catch (error) { return propertyError(error); }
    },
    async POST(request: Request, context: Context) {
      try {
        const actor = await requirePermission("properties.manage");noPropertyQuery(request);
        const id = propertyId((await context.params).id);
        if (service.kind === "images" || service.kind === "floor_plans") {
          const key = propertyId(request.headers.get("idempotency-key") ?? crypto.randomUUID());
          const result = await service.upload(id, actor.user.id, await mediaForm(request, service.kind), key);
          if ("pending" in result) return propertyResponse(result, 202);
          return propertyResponse({ [keys[service.kind][1]]: result.record, message: "Property media uploaded successfully" }, 201);
        }
        const record = await service.mutate(id, actor.user.id, "create", null, mediaInput(await parseJson(request), service.kind, true));
        return propertyResponse({ [keys[service.kind][1]]: record, message: "Property metadata created successfully" }, 201);
      } catch (error) { return propertyError(error); }
    },
  };
}
export function mediaItem(service: Service) {
  return {
    async PATCH(request: Request, context: Context) {
      try {
        const actor = await requirePermission("properties.manage");noPropertyQuery(request);
        const params = await context.params, id = propertyId(params.id), child = propertyId(params[keys[service.kind][2]]);
        const record = await service.mutate(id, actor.user.id, "update", child, mediaInput(await parseJson(request), service.kind));
        return propertyResponse({ [keys[service.kind][1]]: record, message: "Property media updated successfully" });
      } catch (error) { return propertyError(error); }
    },
    async DELETE(request: Request, context: Context) {
      try {
        const actor = await requirePermission("properties.manage");noPropertyQuery(request);
        const params = await context.params, id = propertyId(params.id), child = propertyId(params[keys[service.kind][2]]);
        const result = await service.remove(id, actor.user.id, child);
        if ("pending" in result) return propertyResponse(result, 202);
        return propertyResponse({ property_id: id, [`${service.kind === "floor_plans" ? "floor_plan" : keys[service.kind][1]}_id`]: child, message: "Property media deleted successfully" });
      } catch (error) { return propertyError(error); }
    },
    async FILE(request: Request, context: Context) {
      try {
        noPropertyQuery(request);const params = await context.params;
        return await mediaFile(await previewActor(), propertyId(params.id), service.kind, propertyId(params[keys[service.kind][2]]));
      } catch (error) { return propertyError(error); }
    },
  };
}
