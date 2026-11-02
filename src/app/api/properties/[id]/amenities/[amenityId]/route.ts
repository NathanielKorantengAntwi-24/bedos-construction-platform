import { propertyAmenityService } from "@/features/properties/property-amenity.service";
import { mediaItem } from "@/features/properties/media.routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export const { PATCH, DELETE } = mediaItem(propertyAmenityService);
