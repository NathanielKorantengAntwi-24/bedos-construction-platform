import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import { propertyId } from "./property.validation";
import type { MediaKind, mediaForm } from "./media.validation";

type Json = Record<string, unknown>;
type Operation = { id: string; property_id: string | null; kind: "images" | "floor_plans"; media_id: string; bucket_id: string; storage_path: string; version: number; lease_token: string; state: string };
type Claim = { operation: Operation; acquired: boolean };
const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
const client = () => createAdminClient(boundedFetch);
export async function mediaRpc<T = Json>(name: string, args: Json): Promise<T> {
  try {
    const { data, error } = await client().rpc(name, args);
    if (error) {
      if (error.code === "42501") throw new ApiError("Forbidden", 403);
      if (["22023", "22P02", "22003", "23514"].includes(error.code)) throw new ApiError("Invalid media request.", 400);
      if (error.code === "P0002") throw new ApiError("Property or media not found.", 404);
      if (["P0001", "23505", "23503"].includes(error.code)) throw new ApiError("Media changed, is pending or has reached its limit.", 409);
      if (error.code === "P0429") throw new ApiError("Upload rate exceeded. Retry later.", 429);
      console.error("Property media database failure", { operation: name, code: error.code });
      throw new ApiError("Unable to complete media request.", 503);
    }
    if (data === null || data === undefined) throw new ApiError("Unable to complete media request.", 503);
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Property media database unavailable", { operation: name });
    throw new ApiError("Unable to complete media request.", 503);
  }
}
export function fileUrl(property: string, kind: MediaKind, id: string) {
  return `/api/properties/${property}/${kind === "images" ? "images" : "floor-plans"}/${id}/file`;
}
function project(record: Json, property: string, kind: MediaKind) {
  const { storage_path: ignored, ...safe } = record;void ignored;
  return ["images", "floor_plans"].includes(kind) ? { ...safe, image_url: fileUrl(property, kind, String(record.id)) } : safe;
}
function pending(op: Pick<Operation, "id" | "state">) { return { pending: true as const, operation_id: op.id, state: op.state }; }
async function removeClaim(actor: string, claim: Claim) {
  const op = claim.operation;
  if (op.state === "deleted") return { deleted: true as const, operation_id: op.id };
  if (!claim.acquired) return pending(op);
  try {
    const result = await client().storage.from(op.bucket_id).remove([op.storage_path]);
    if (result.error) return pending(op);
    await mediaRpc("bedos_media_operation", { p_actor: actor, p_action: "complete", p_operation: op.id, p_version: op.version, p_token: op.lease_token });
    return { deleted: true as const, operation_id: op.id };
  } catch { return pending(op); }
}
export async function retryMediaOperation(actor: string, operation: string) {
  return removeClaim(actor, await mediaRpc<Claim>("bedos_media_operation", { p_actor: actor, p_action: "retry", p_operation: propertyId(operation) }));
}
export function propertyMediaService(kind: MediaKind) {
  return {
    kind,
    async list(property: string, actor: string | null, page: number, limit: number) {
      const data = await mediaRpc<{ records: Json[]; pagination: Json }>("bedos_media_read", { p_actor: actor, p_property: propertyId(property), p_kind: kind, p_page: page, p_limit: limit });
      return { records: data.records.map(record => project(record, property, kind)), pagination: data.pagination };
    },
    async mutate(property: string, actor: string, action: "create" | "update" | "delete", id: string | null, input: Json) {
      const record = await mediaRpc("bedos_media_metadata", { p_actor: actor, p_property: propertyId(property), p_kind: kind, p_action: action, p_id: id ? propertyId(id) : null, p_input: input });
      return project(record, property, kind);
    },
    async upload(property: string, actor: string, input: Awaited<ReturnType<typeof mediaForm>>, key: string) {
      const claim = await mediaRpc<Claim>("bedos_media_upload", { p_actor: actor, p_property: propertyId(property), p_kind: kind, p_input: input.metadata, p_mime: input.mime, p_size: input.bytes.length, p_hash: input.sha256, p_key: propertyId(key) });
      let op = claim.operation;
      if (claim.acquired) {
        try {
          const uploaded = await client().storage.from(op.bucket_id).upload(op.storage_path, input.bytes, { contentType: input.mime, upsert: false, cacheControl: "0" });
          if (uploaded.error) return pending(op);
          const record = await mediaRpc("bedos_media_finalize", { p_actor: actor, p_operation: op.id, p_version: op.version, p_token: op.lease_token });
          return { record: project(record, property, kind) };
        } catch {
          // A lost response is not proof of rollback. Reconcile before any cleanup.
          try { op = await mediaRpc<Operation>("bedos_media_operation", { p_actor: actor, p_action: "status", p_operation: op.id }); }
          catch { return pending(op); }
        }
      }
      if (op.state === "ready") {
        const record = await mediaRpc("bedos_media_read", { p_actor: actor, p_property: property, p_kind: kind, p_id: op.media_id });
        return { record: project(record, property, kind) };
      }
      if (op.state === "deleted") throw new ApiError("This upload was deleted. Use a new idempotency key.", 409);
      return pending(op);
    },
    async remove(property: string, actor: string, id: string) {
      if (!["images", "floor_plans"].includes(kind)) {
        await this.mutate(property, actor, "delete", id, {});return { deleted: true as const };
      }
      return removeClaim(actor, await mediaRpc<Claim>("bedos_media_operation", { p_actor: actor, p_action: "delete", p_property: propertyId(property), p_kind: kind, p_media: propertyId(id) }));
    },
  };
}
export async function mediaFile(actor: string | null, property: string, kind: MediaKind, id: string) {
  const args = { p_actor: actor, p_property: propertyId(property), p_kind: kind, p_id: propertyId(id), p_file: true };
  const proof = await mediaRpc<{ bucket_id: string; storage_path: string; mime: string; file_size: number; sha256: string }>("bedos_media_read", args);
  const result = await client().storage.from(proof.bucket_id).download(proof.storage_path);
  if (result.error || !result.data) throw new ApiError("Media file is temporarily unavailable.", 503);
  const bytes = Buffer.from(await result.data.arrayBuffer());
  const { createHash } = await import("node:crypto");
  if (bytes.length !== proof.file_size || createHash("sha256").update(bytes).digest("hex") !== proof.sha256) throw new ApiError("Media file is temporarily unavailable.", 503);
  // Recheck publication/deletion after the external read, before sending any bytes.
  await mediaRpc("bedos_media_read", args);
  return new Response(bytes, { headers: { "Content-Type": proof.mime, "Content-Length": String(bytes.length), "Content-Disposition": `inline; filename="${id}.${proof.mime === "image/jpeg" ? "jpg" : proof.mime.split("/")[1]}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
