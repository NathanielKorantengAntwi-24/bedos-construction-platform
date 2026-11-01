import { errorResponse } from "@/server/http/api-error";
export function propertyResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function propertyError(error: unknown) {
  const response = errorResponse(error);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
