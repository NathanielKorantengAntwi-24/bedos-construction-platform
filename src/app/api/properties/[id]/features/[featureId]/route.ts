import { propertyFeatureService } from "@/features/properties/property-feature.service";
import { mediaItem } from "@/features/properties/media.routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export const { PATCH, DELETE } = mediaItem(propertyFeatureService);
