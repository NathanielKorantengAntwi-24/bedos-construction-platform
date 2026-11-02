import { ApiError } from "@/server/http/api-error";
import { propertyId } from "./property.validation";
import type { CreateViewingRequestFields, UpdateViewingRequestInput, ViewingQuery } from "./viewing-request.types";

export const VIEWING_STATUSES = ["new", "contacted", "scheduled", "completed", "cancelled"] as const;
function invalid(field: string): never { throw new ApiError(`Invalid viewing ${field}.`, 400); }
export function viewingId(value: unknown): string {
  if (typeof value !== "string") invalid("ID");
  return propertyId(value);
}
export function viewingVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647) invalid("expected_version");
  return value;
}
export function viewingObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("body");
  return value as Record<string, unknown>;
}
export function parseViewingInput(body: unknown, create: true): CreateViewingRequestFields;
export function parseViewingInput(body: unknown, create: false): UpdateViewingRequestInput;
export function parseViewingInput(body: unknown, create: boolean) {
  const input = viewingObject(body), result: Record<string, unknown> = {};
  const fields = ["preferred_date", "preferred_time", "message", ...(!create ? ["status", "assigned_to", "expected_version"] : [])];
  if (Object.keys(input).some(key => !fields.includes(key))) invalid("fields");
  if (!create) {
    result.expected_version = viewingVersion(input.expected_version);
    if (Object.keys(input).length < 2) invalid("update fields");
  }
  for (const [key, value] of Object.entries(input)) {
    if (key === "expected_version") continue;
    if (value === null && key !== "status") { result[key] = null; continue; }
    if (typeof value !== "string" || value.includes("\0")) invalid(key);
    if (key === "message") {
      if ([...value.trim()].length > 2000) invalid(key);
      result[key] = value.trim() || null;
    } else if (key === "preferred_date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(key);
      const [year, month, day] = value.split("-").map(Number);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      if (!year || month < 1 || month > 12 || day < 1 || day > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) invalid(key);
      result[key] = value;
    } else if (key === "preferred_time") {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) invalid(key);
      result[key] = value.length === 5 ? value + ":00" : value;
    } else if (key === "status") {
      if (!VIEWING_STATUSES.some(status => status === value)) invalid(key);
      result[key] = value;
    } else result[key] = viewingId(value);
  }
  return result;
}
export function parseViewingQuery(params: URLSearchParams, staff: boolean, propertyScoped = false, events = false): ViewingQuery {
  const result: ViewingQuery = { page: 1, limit: 25 };
  const allowed = ["page", "limit", ...(!events ? ["status", ...(!propertyScoped ? ["property_id"] : []), ...(staff ? ["customer_id", "assigned_to"] : [])] : [])];
  for (const [key, value] of params) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) invalid("query parameters");
    if (key === "page" || key === "limit") {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(+value) || +value > (key === "limit" ? 100 : 2147483647)) invalid(key);
      result[key] = +value;
    } else if (key === "status") {
      if (!VIEWING_STATUSES.some(status => status === value)) invalid(key);
      result.status = value as ViewingQuery["status"];
    } else result[key as "property_id" | "customer_id" | "assigned_to"] = viewingId(value);
  }
  return result;
}
export function viewingDeleteQuery(params: URLSearchParams) {
  if ([...params.keys()].length !== 1 || params.getAll("expected_version").length !== 1) invalid("deletion query");
  const value = params.get("expected_version")!;
  if (!/^[1-9]\d*$/.test(value)) invalid("expected_version");
  return viewingVersion(+value);
}
export async function viewingJson(request: Request, empty = false) {
  const maximum = empty ? 1024 : 16384, reader = request.body?.getReader();
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    if (reader) for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new ApiError("Viewing request body is too large.", 413); }
      chunks.push(part.value);
    }
    if (!size && empty) return {};
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    invalid("JSON body");
  } finally { reader?.releaseLock(); }
}
