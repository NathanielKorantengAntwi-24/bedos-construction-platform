import { propertyImageService } from "@/features/properties/property-image.service";
import { mediaItem } from "@/features/properties/media.routes";
export const runtime = "nodejs";
export const maxDuration = 60;
export const GET = mediaItem(propertyImageService).FILE;
