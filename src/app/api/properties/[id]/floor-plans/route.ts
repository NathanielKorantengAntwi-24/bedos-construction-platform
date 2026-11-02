import { propertyFloorPlanService } from "@/features/properties/property-floor-plan.service";
import { mediaCollection } from "@/features/properties/media.routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export const { GET, POST } = mediaCollection(propertyFloorPlanService);
