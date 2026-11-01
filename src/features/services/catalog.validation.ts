import { ApiError } from "@/server/http/api-error";
import type { CreateServiceInput, UpdateServiceInput } from "./service.types";
import type { CreateServiceCategoryInput, UpdateServiceCategoryInput } from "./service-category.types";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const SERVICE_STATUSES = ["draft", "published", "archived"] as const;
export type CatalogQuery = {
  page: number; page_size: number; q: string | null;
  category_id: string | null; featured: boolean | null;
  status: (typeof SERVICE_STATUSES)[number] | null;
};
export function catalogId(value: string): string {
  if (!UUID.test(value)) throw new ApiError("Invalid record ID.", 400);
  return value.toLowerCase();
}
export function publicServiceSlug(value: string): string {
  // Preserve exact legacy slugs on reads; new input limits apply only to writes.
  if (!value || value.includes("\0")) throw new ApiError("Invalid service slug.", 400);
  return value;
}
export function parseCatalogInput(body: unknown, category: true, create: true): CreateServiceCategoryInput;
export function parseCatalogInput(body: unknown, category: true, create: false): UpdateServiceCategoryInput;
export function parseCatalogInput(body: unknown, category: false, create: true): CreateServiceInput;
export function parseCatalogInput(body: unknown, category: false, create: false): UpdateServiceInput;
export function parseCatalogInput(body: unknown, category: boolean, create: boolean) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("Request body must be an object.", 400);
  const input = body as Record<string, unknown>;
  const allowed = category ? ["name", "slug", "description"] : ["name", "slug", "description", "category_id", "featured", "status"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new ApiError("Unknown catalog field.", 400);
  if (!create && Object.keys(input).length === 0) throw new ApiError("At least one field is required.", 400);
  const result: Record<string, unknown> = {};
  for (const key of ["name", "slug", "description"]) {
    if (!(key in input) && !(create && key !== "description")) continue;
    const value = input[key];
    if (key === "description" && value === null) { result[key] = null; continue; }
    if (typeof value !== "string" || value.includes("\0")) throw new ApiError(`Invalid ${key}.`, 400);
    const trimmed = value.trim();
    if ((key !== "description" && !trimmed) || [...trimmed].length > (key === "description" ? 10000 : 200)) throw new ApiError(`Invalid ${key} length.`, 400);
    result[key] = key === "description" ? trimmed || null : trimmed;
  }
  if ("category_id" in input) {
    if (input.category_id !== null && typeof input.category_id !== "string") throw new ApiError("Invalid category ID.", 400);
    result.category_id = input.category_id === null ? null : catalogId(input.category_id as string);
  }
  if ("featured" in input) {
    if (typeof input.featured !== "boolean") throw new ApiError("Featured must be boolean.", 400);
    result.featured = input.featured;
  }
  if ("status" in input) {
    if (!SERVICE_STATUSES.some(status => status === input.status)) throw new ApiError("Invalid service status.", 400);
    result.status = input.status;
  }
  return result;
}
export function parseCatalogQuery(params: URLSearchParams, category = false, publicRead = false): CatalogQuery {
  const allowed = ["page", "page_size", "q", ...(!category ? ["category_id", "featured", ...(!publicRead ? ["status"] : [])] : [])];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new ApiError("Unknown or repeated catalog query parameter.", 400);
  }
  function integer(key: string, fallback: number, maximum: number) {
    const value = params.get(key);
    if (value === null) return fallback;
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) throw new ApiError(`Invalid ${key}.`, 400);
    return Number(value);
  }
  const q = params.get("q")?.trim() || null;
  if (q && ([...q].length > 100 || q.includes("\0"))) throw new ApiError("Invalid search query.", 400);
  const featured = params.get("featured");
  if (featured !== null && featured !== "true" && featured !== "false") throw new ApiError("Invalid featured filter.", 400);
  const status = params.get("status");
  if (status !== null && !SERVICE_STATUSES.some(value => value === status)) throw new ApiError("Invalid status filter.", 400);
  return {
    page: integer("page", 1, 2147483647), page_size: integer("page_size", 25, 100), q,
    category_id: params.has("category_id") ? catalogId(params.get("category_id")!) : null,
    featured: featured === null ? null : featured === "true", status: status as CatalogQuery["status"],
  };
}
export function noDetailQuery(request: Request) {
  if (new URL(request.url).search) throw new ApiError("Detail queries do not accept parameters.", 400);
}
