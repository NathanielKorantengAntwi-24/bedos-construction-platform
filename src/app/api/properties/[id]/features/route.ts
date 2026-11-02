import { propertyFeatureService } from "@/features/properties/property-feature.service";
import { mediaCollection } from "@/features/properties/media.routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export const { GET, POST } = mediaCollection(propertyFeatureService);
