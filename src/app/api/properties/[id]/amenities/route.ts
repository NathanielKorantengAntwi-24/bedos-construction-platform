import { propertyAmenityService } from "@/features/properties/property-amenity.service";
import { mediaCollection } from "@/features/properties/media.routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export const { GET, POST } = mediaCollection(propertyAmenityService);
