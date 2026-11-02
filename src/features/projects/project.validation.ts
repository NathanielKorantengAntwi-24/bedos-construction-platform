import { ApiError } from "@/server/http/api-error";
import { FILE_LIMIT, normalizeImage } from "@/server/media/image";
export type Json = Record<string, unknown>;
export type Kind = "project" | "category" | "stage" | "image" | "status" | "reorder";
const fields: Record<Kind, string[]> = {
  project: ["title", "slug", "description", "project_type", "location", "client_name", "start_date", "category_id", "featured", "service_ids"],
  category: ["name", "slug", "description"], stage: ["name", "description", "stage_order", "status", "start_date", "completion_date"],
  image: ["phase", "alt_text", "display_order", "is_primary"], status: ["status", "completion_date"], reorder: ["stage_ids"],
};
export function invalid(message = "Invalid construction request."): never { throw new ApiError(message, 400); }
export function projectId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) invalid("Invalid identifier.");
  return value.toLowerCase();
}
export function integer(value: unknown, min = 0, max = 2147483647): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) invalid("Invalid integer.");return value;
}
export function date(value: unknown) {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value < "0001-01-01" || value > "9999-12-31") invalid("Invalid date.");
  const parsed = new Date(value + "T00:00:00Z");if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid("Invalid date.");return value;
}
export function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Body must be an object.");return value as Json;
}
export function projectInput(value: unknown, kind: Kind, create = false): Json {
  const input = object(value), result: Json = {};
  if ((!create && !Object.keys(input).length) || Object.keys(input).some(k => !fields[kind].includes(k))) invalid("Invalid fields.");
  const required = create ? ({ project: ["title", "slug"], category: ["name", "slug"], stage: ["name", "stage_order"], image: ["phase"], status: ["status"], reorder: ["stage_ids"] }[kind]) : kind === "status" ? ["status"] : kind === "reorder" ? ["stage_ids"] : [];
  if (required.some(k => !(k in input))) invalid("Required field missing.");
  for (const [k, v] of Object.entries(input)) {
    if (["service_ids", "stage_ids"].includes(k)) {
      if (!Array.isArray(v) || v.length > (k === "service_ids" ? 50 : 100)) invalid("Invalid references.");
      const ids = v.map(projectId);if (new Set(ids).size !== ids.length) invalid("Duplicate references.");result[k] = ids;
    } else if (k === "category_id") result[k] = v === null ? null : projectId(v);
    else if (["featured", "is_primary"].includes(k)) { if (typeof v !== "boolean") invalid("Invalid boolean.");result[k] = v; }
    else if (["stage_order", "display_order"].includes(k)) result[k] = integer(v);
    else if (["start_date", "completion_date"].includes(k)) result[k] = v === null ? null : date(v);
    else {
      if (v === null && ["description", "project_type", "location", "client_name", "alt_text"].includes(k)) { result[k] = null;continue; }
      if (typeof v !== "string" || v.includes("\0")) invalid("Invalid text.");
      const text = v.trim(), max = k === "description" ? 10000 : k === "alt_text" ? 1000 : ["location", "client_name"].includes(k) ? 500 : 200;
      if ([...text].length > max || (["title", "name", "slug", "status", "phase"].includes(k) && !text)) invalid("Invalid text length.");
      if (k === "slug" && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(text)) invalid("Invalid slug.");
      if (k === "phase" && !["before", "during", "after"].includes(text)) invalid("Invalid phase.");
      if (k === "status" && !(kind === "stage" ? ["pending", "in_progress", "completed"] : ["draft", "ongoing", "completed", "archived"]).includes(text)) invalid("Invalid status.");
      result[k] = text || null;
    }
  }
  if (create && kind === "stage" && ((result.status && result.status !== "pending") || result.start_date || result.completion_date)) invalid("New stages must be pending.");
  return result;
}
export function versioned(value: unknown, kind?: Kind) {
  const { expected_version, ...input } = object(value);return { version: integer(expected_version, 1), input: kind ? projectInput(input, kind) : Object.keys(input).length ? invalid("Unexpected fields.") : {} };
}
export function projectQuery(params: URLSearchParams, isPublic = false, pageOnly = false): Json {
  const result: Json = { page: 1, page_size: 25 };
  for (const [k, v] of params) {
    if (params.getAll(k).length !== 1 || !(pageOnly ? ["page", "page_size"] : ["page", "page_size", "q", "category_id", "service_id", "status", "featured"]).includes(k)) invalid("Unknown or repeated query.");
    if (["page", "page_size"].includes(k)) {
      if (!/^[1-9][0-9]*$/.test(v)) invalid("Invalid pagination.");result[k] = integer(+v, 1, k === "page_size" ? 100 : 2147483647);
    } else if (["category_id", "service_id"].includes(k)) result[k] = projectId(v);
    else if (k === "featured") { if (!["true", "false"].includes(v)) invalid("Invalid featured filter.");result[k] = v === "true"; }
    else if (k === "status") { if (!(isPublic ? ["ongoing", "completed"] : ["draft", "ongoing", "completed", "archived"]).includes(v)) invalid("Invalid status filter.");result[k] = v; }
    else { if (!v.trim() || [...v].length > 200 || v.includes("\0")) invalid("Invalid search.");result[k] = v.trim(); }
  }return result;
}
export function noQuery(request: Request) { if (new URL(request.url).search) invalid("Query parameters are not supported."); }
export function projectSlug(value: string) { if (!value || value.length > 200 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) invalid("Invalid slug.");return value; }
export async function boundedBody(request: Request, max: number): Promise<Buffer> {
  const length = request.headers.get("content-length");if (length && (!/^\d+$/.test(length) || +length > max)) throw new ApiError("Request too large.", 413);
  const reader = request.body?.getReader();if (!reader) invalid("Body required.");const chunks: Uint8Array[] = [];let size = 0;
  try { while (true) { const { done, value } = await reader.read();if (done) break;size += value.length;if (size > max) { await reader.cancel();throw new ApiError("Request too large.", 413); }chunks.push(value); } } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function projectJson(request: Request) {
  const bytes = await boundedBody(request, 128 * 1024);try { return JSON.parse(bytes.toString("utf8")) as unknown; } catch { invalid("Invalid JSON."); }
}
export async function projectForm(request: Request) {
  const type = request.headers.get("content-type") ?? "";if (!type.toLowerCase().startsWith("multipart/form-data;")) invalid("Multipart body required.");
  const bytes = await boundedBody(request, FILE_LIMIT + 64 * 1024);let form: FormData;
  try { form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": type } }).formData(); } catch { invalid("Malformed multipart body."); }
  const metadata: Json = {};let expected: unknown;
  for (const [k, v] of form) {
    if (!["file", "expected_version", ...fields.image].includes(k) || form.getAll(k).length !== 1) invalid("Unknown or repeated upload field.");if (k === "file") continue;
    if (typeof v !== "string") invalid("Metadata must be text.");
    if (["display_order", "expected_version"].includes(k)) { if (!/^(0|[1-9][0-9]*)$/.test(v)) invalid("Invalid integer.");if (k === "expected_version") expected = +v;else metadata[k] = +v; }
    else if (k === "is_primary") { if (!["true", "false"].includes(v)) invalid("Invalid primary flag.");metadata[k] = v === "true"; }
    else metadata[k] = v;
  }
  const version = integer(expected, 1), input = projectInput(metadata, "image", true), file = form.get("file");
  if (!(file instanceof File) || !file.size) invalid("Nonempty image required.");if (file.size > FILE_LIMIT) throw new ApiError("Image exceeds 3 MiB.", 413);
  return { version, input, ...await normalizeImage(Buffer.from(await file.arrayBuffer()), file.type) };
}
