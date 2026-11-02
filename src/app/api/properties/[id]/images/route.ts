import { propertyImageService } from "@/features/properties/property-image.service";
import { mediaCollection } from "@/features/properties/media.routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export const { GET, POST } = mediaCollection(propertyImageService);
