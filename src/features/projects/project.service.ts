import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import { createHash } from "node:crypto";
import type { Json, projectForm } from "./project.validation";

type Operation = { id: string; state: string; media_id: string; project_id: string | null; bucket_id: string; storage_path: string; version: number; lease_token: string };
type Claim = { operation: Operation; acquired: boolean };
type Detail = Json & { version: number; images: (Json & { id: string })[] };
const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
const client = () => createAdminClient(boundedFetch);
export async function projectRpc<T = Json>(name: string, args: Json): Promise<T> {
  try {
    const { data, error } = await client().rpc(name, args);
    if (error) {
      if (error.code === "42501") throw new ApiError("Forbidden", 403);
      if (["22023", "22P02", "22003", "23514", "22007", "22008"].includes(error.code)) throw new ApiError("Invalid construction request.", 400);
      if (error.code === "P0002") throw new ApiError("Construction record not found.", 404);
      if (["P0001", "23505", "23503", "40001", "40P01"].includes(error.code)) throw new ApiError("Construction record changed or is in use.", 409);
      console.error("Construction database failure", { operation: name, code: error.code });throw new ApiError("Construction service unavailable.", 503);
    }
    if (data === null || data === undefined) throw new ApiError("Construction service unavailable.", 503);return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Construction service unavailable", { operation: name });throw new ApiError("Construction service unavailable.", 503);
  }
}
export function readProjects<T = Json>(actor: string | null, entity = "projects", query: Json = {}, id?: string, slug?: string) {
  return projectRpc<T>("bedos_project_read", { p_actor: actor, p_entity: entity, p_query: query, p_id: id ?? null, p_slug: slug ?? null });
}
export function mutateProject(actor: string, entity: string, action: string, input: Json, id?: string, parent?: string, version?: number) {
  return projectRpc("bedos_project_mutate", { p_actor: actor, p_entity: entity, p_action: action, p_input: input, p_id: id ?? null, p_project: parent ?? null, p_version: version ?? null });
}
function media<T = Json>(actor: string | null, action: string, args: Json) { return projectRpc<T>("bedos_project_media", { p_actor: actor, p_action: action, ...args }); }
const pending = (op: Operation) => ({ pending: true as const, operation_id: op.id, state: op.state });
async function ready(actor: string, project: string, op: Operation) {
  const detail = await readProjects<Detail>(actor, "projects", {}, project), image = detail.images.find(x => x.id === op.media_id);
  if (!image) throw new ApiError("Image is unavailable or being removed.", 409);return { image, project_version: detail.version };
}
export async function uploadProjectImage(actor: string, project: string, form: Awaited<ReturnType<typeof projectForm>>, key: string) {
  const claim = await media<Claim>(actor, "reserve", { p_project: project, p_version: form.version, p_input: form.input, p_key: key, p_proof: { mime: form.mime, file_size: form.bytes.length, sha256: form.sha256 } });
  let op = claim.operation;
  if (claim.acquired) {
    try {
      const result = await client().storage.from(op.bucket_id).upload(op.storage_path, form.bytes, { upsert: false, contentType: form.mime, cacheControl: "0" });
      if (result.error) return pending(op);
      const finished = await media<{ operation: Operation }>(actor, "finalize", { p_operation: op.id, p_version: op.version, p_proof: { lease_token: op.lease_token } });op = finished.operation;
    } catch {
      // A lost acknowledgement may follow a committed finalize. Never delete on that assumption.
      try { op = await media<Operation>(actor, "status", { p_operation: op.id }); } catch { return pending(op); }
    }
  }
  if (op.state === "ready") return ready(actor, project, op);
  if (op.state === "deleted") throw new ApiError("Upload was deleted; use a new idempotency key.", 409);
  return pending(op);
}
async function removeClaim(actor: string, claim: Claim) {
  const op = claim.operation;if (op.state === "deleted") return { deleted: true as const };
  if (!claim.acquired) return pending(op);
  try {
    const result = await client().storage.from(op.bucket_id).remove([op.storage_path]);if (result.error) return pending(op);
    const done = await media(actor, "complete", { p_operation: op.id, p_version: op.version, p_proof: { lease_token: op.lease_token } });return { deleted: true as const, project_version: done.project_version };
  } catch { return pending(op); }
}
export function deleteProjectImage(actor: string, project: string, id: string, version: number) {
  return media<Claim>(actor, "delete", { p_project: project, p_media: id, p_version: version }).then(claim => removeClaim(actor, claim));
}
export function retryProjectImage(actor: string, operation: string) { return media<Claim>(actor, "retry", { p_operation: operation }).then(claim => removeClaim(actor, claim)); }
export async function editProjectImage(actor: string, project: string, id: string, version: number, input: Json) {
  const result = await media<{ operation: Operation }>(actor, "update", { p_project: project, p_media: id, p_version: version, p_input: input });return ready(actor, project, result.operation);
}
export async function projectImageFile(actor: string | null, project: string, id: string) {
  const args = { p_project: project, p_media: id }, proof = await media<{ bucket_id: string; storage_path: string; mime: string; file_size: number; sha256: string }>(actor, "proof", args);
  const result = await client().storage.from(proof.bucket_id).download(proof.storage_path);
  if (result.error || !result.data) throw new ApiError("Image temporarily unavailable.", 503);
  const bytes = Buffer.from(await result.data.arrayBuffer());
  if (bytes.length !== proof.file_size || createHash("sha256").update(bytes).digest("hex") !== proof.sha256) throw new ApiError("Image temporarily unavailable.", 503);
  const current = await media(actor, "proof", args);
  if (current.sha256 !== proof.sha256 || current.storage_path !== proof.storage_path) throw new ApiError("Image changed.", 409);
  return new Response(bytes, { headers: { "Content-Type": proof.mime, "Content-Length": String(bytes.length), "Content-Disposition": `inline; filename="${id}.${proof.mime === "image/jpeg" ? "jpg" : proof.mime.split("/")[1]}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
