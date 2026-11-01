import { ApiError } from "@/server/http/api-error";
import type { CreatePropertyInput, PropertyListFilters, PropertyStatus, UpdatePropertyInput } from "./property.types";

export const PROPERTY_STATUSES = ["draft", "published", "reserved", "sold", "unavailable", "archived"] as const;
const required = ["title", "slug", "property_type", "listing_type"];
const optionalText = ["description", "location", "address", "city", "region"];
const numbers = ["price", "bedrooms", "bathrooms", "floor_area", "land_area"];
const allowed = [...required, ...optionalText, ...numbers, "currency", "featured"];
function invalid(field: string): never { throw new ApiError(`Invalid property ${field}.`, 400); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("body");
  return value as Record<string, unknown>;
}
export function propertyId(value: string): string {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) invalid("ID");
  return value.toLowerCase();
}
function text(value: unknown, key: string, max = 200): string {
  if (typeof value !== "string" || value.includes("\0") || !value.trim() || [...value.trim()].length > max) invalid(key);
  return value.trim();
}
export function parsePropertyInput(body: unknown, create: true): CreatePropertyInput;
export function parsePropertyInput(body: unknown, create: false): UpdatePropertyInput;
export function parsePropertyInput(body: unknown, create: boolean) {
  const input = object(body), result: Record<string, unknown> = {};
  if (!Object.keys(input).length || Object.keys(input).some(key => !allowed.includes(key))) invalid("fields");
  if (create && required.some(key => !(key in input))) invalid("required fields");
  for (const [key, value] of Object.entries(input)) {
    if (required.includes(key) || optionalText.includes(key) || key === "currency") {
      if (optionalText.includes(key) && (value === null || (typeof value === "string" && !value.trim()))) { result[key] = null; continue; }
      result[key] = text(value, key, key === "description" ? 10000 : key === "address" ? 1000 : 200);
      if (key === "slug" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result[key] as string)) invalid(key);
      if (key === "currency" && !/^[A-Z]{3}$/.test(result[key] as string)) invalid(key);
    } else if (key === "featured") {
      if (typeof value !== "boolean") invalid(key);
      result[key] = value;
    } else {
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (value > (key === "price" ? 999999999999.99 : key === "floor_area" || key === "land_area" ? 9999999999.99 : 2147483647)) || ((key === "bedrooms" || key === "bathrooms") && (!Number.isInteger(value) || value > 2147483647)))) invalid(key);
      if (value !== null && (key === "price" || key === "floor_area" || key === "land_area") && !/^\d+(?:\.\d{1,2})?$/.test(String(value))) invalid(key);
      result[key] = value;
    }
  }
  return result;
}
export type PropertyStatusInput = { status: PropertyStatus; expected_status: PropertyStatus; reason: string };
export function parsePropertyStatus(body: unknown): PropertyStatusInput {
  const input = object(body);
  if (Object.keys(input).length !== 3 || Object.keys(input).some(key => !["status", "expected_status", "reason"].includes(key))) invalid("status fields");
  for (const key of ["status", "expected_status"]) if (!PROPERTY_STATUSES.some(status => status === input[key])) invalid(key);
  return { status: input.status as PropertyStatus, expected_status: input.expected_status as PropertyStatus, reason: text(input.reason, "reason", 1000) };
}
export function parsePropertyQuery(params: URLSearchParams, staff = false): PropertyListFilters {
  const keys = ["search", "property_type", "listing_type", "city", "region", "featured", "page", "limit", "min_price", "max_price", "min_bedrooms", "max_bedrooms", "min_bathrooms", "max_bathrooms", ...(staff ? ["status"] : [])];
  const result: Record<string, unknown> = { page: 1, limit: 12 };
  for (const [key, value] of params) {
    if (!keys.includes(key) || params.getAll(key).length !== 1) invalid("query parameters");
    if (key === "page" || key === "limit") {
      if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(+value) || +value > (key === "limit" ? 100 : 2147483647)) invalid(key);
      result[key] = +value;
    } else if (key.startsWith("min_") || key.startsWith("max_")) {
      if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) || !Number.isFinite(+value) || +value > Number.MAX_SAFE_INTEGER || (!key.endsWith("price") && (!Number.isInteger(+value) || +value > 2147483647))) invalid(key);
      result[key] = +value;
    } else if (key === "featured") {
      if (value !== "true" && value !== "false") invalid(key);
      result[key] = value === "true";
    } else if (key === "status") {
      if (!PROPERTY_STATUSES.some(status => status === value)) invalid(key);
      result[key] = value;
    } else result[key] = text(value, key, key === "search" ? 100 : 200);
  }
  for (const key of ["price", "bedrooms", "bathrooms"]) {
    const min = result[`min_${key}`], max = result[`max_${key}`];
    if (typeof min === "number" && typeof max === "number" && min > max) invalid(`${key} range`);
  }
  return result as PropertyListFilters;
}
export function noPropertyQuery(request: Request) { if (new URL(request.url).search) invalid("query parameters"); }
