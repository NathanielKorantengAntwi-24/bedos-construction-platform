import { ApiError } from "@/server/http/api-error";

export type MediaKind = "images" | "floor_plans" | "features" | "amenities";
import { FILE_LIMIT, normalizeImage } from "@/server/media/image";
export { FILE_LIMIT, normalizeImage };
const BODY_LIMIT = FILE_LIMIT + 64 * 1024;
const fields: Record<MediaKind, string[]> = {
  images: ["alt_text", "display_order", "is_primary"],
  floor_plans: ["title", "description", "display_order"],
  features: ["name", "value"], amenities: ["name"],
};
function invalid(message: string): never { throw new ApiError(message, 400); }
export function mediaInput(value: unknown, kind: MediaKind, create = false): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Body must be an object.");
  const input = value as Record<string, unknown>, result: Record<string, unknown> = {};
  if ((!create && !Object.keys(input).length) || Object.keys(input).some(key => !fields[kind].includes(key))) invalid("Invalid media fields.");
  if (create && ["features", "amenities"].includes(kind) && !("name" in input)) invalid("Name is required.");
  for (const [key, raw] of Object.entries(input)) {
    if (key === "display_order") {
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 2147483647) invalid("Invalid display order.");
      result[key] = raw;
    } else if (key === "is_primary") {
      if (typeof raw !== "boolean") invalid("Primary must be boolean.");
      result[key] = raw;
    } else {
      if (raw === null && key !== "name") { result[key] = null; continue; }
      if (typeof raw !== "string" || raw.includes("\0")) invalid(`Invalid ${key}.`);
      const text = raw.trim(), max = key === "description" ? 10000 : ["name", "title"].includes(key) ? 200 : 1000;
      if ((key === "name" && !text) || [...text].length > max) invalid(`Invalid ${key} length.`);
      result[key] = text || null;
    }
  }
  return result;
}
export function mediaPage(params: URLSearchParams) {
  const result = { page: 1, limit: 25 };
  for (const [key, value] of params) {
    if (!["page", "limit"].includes(key) || params.getAll(key).length !== 1 || !/^[1-9][0-9]*$/.test(value) || +value > (key === "limit" ? 100 : 2147483647)) invalid("Invalid media pagination.");
    result[key as "page" | "limit"] = +value;
  }
  return result;
}
export async function mediaForm(request: Request, kind: "images" | "floor_plans") {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) invalid("Multipart form data is required.");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || +length > BODY_LIMIT)) throw new ApiError("Upload body exceeds the allowed limit.", 413);
  const reader = request.body?.getReader();
  if (!reader) invalid("File is required.");
  const chunks: Uint8Array[] = [];let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) { await reader.cancel();throw new ApiError("Upload body exceeds the allowed limit.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData(); }
  catch { invalid("Malformed multipart body."); }
  const input: Record<string, unknown> = {};
  for (const [key, value] of form) {
    if (!["file", ...fields[kind]].includes(key) || form.getAll(key).length !== 1) invalid("Unknown or repeated upload field.");
    if (key === "file") continue;
    if (typeof value !== "string") invalid("Metadata must be text.");
    if (key === "display_order") {
      if (!/^(0|[1-9][0-9]*)$/.test(value)) invalid("Invalid display order.");
      input[key] = +value;
    } else if (key === "is_primary") {
      if (value !== "true" && value !== "false") invalid("Invalid primary flag.");
      input[key] = value === "true";
    } else input[key] = value;
  }
  const metadata = mediaInput(input, kind, true), file = form.get("file");
  if (!(file instanceof File) || !file.size) invalid("A nonempty image is required.");
  if (file.size > FILE_LIMIT) throw new ApiError("Image must not exceed 3 MiB.", 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  return { metadata, ...(await normalizeImage(bytes, file.type)) };
}
