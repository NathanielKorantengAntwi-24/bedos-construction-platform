import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http/api-error";
// Publication changes must take effect immediately, including for public reads.
export function catalogResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
export function catalogError(error: unknown) {
  const response = errorResponse(error);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
