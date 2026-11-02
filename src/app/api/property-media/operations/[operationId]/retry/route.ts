import { requirePermission } from "@/server/auth/require-permission";
import { retryMediaOperation } from "@/features/properties/media.service";
import { propertyResponse, propertyError } from "@/features/properties/property.http";
import { propertyId, noPropertyQuery } from "@/features/properties/property.validation";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ operationId: string }> }) {
  try {
    const actor = await requirePermission("properties.manage");noPropertyQuery(request);
    // The retry action takes no caller-selected path, bucket or action payload.
    const reader = request.body?.getReader();let body = "", size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      try {
        while (true) {
          const next = await reader.read();if (next.done) break;
          size += next.value.byteLength;
          if (size > 1024) { await reader.cancel();return propertyResponse({ error: "Retry body is too large." }, 413); }
          body += decoder.decode(next.value, { stream: true });
        }
        body += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    if (body.trim() && body.trim() !== "{}") return propertyResponse({ error: "Retry does not accept input fields." }, 400);
    const result = await retryMediaOperation(actor.user.id, propertyId((await context.params).operationId));
    return propertyResponse(result, "pending" in result ? 202 : 200);
  } catch (error) { return propertyError(error); }
}
