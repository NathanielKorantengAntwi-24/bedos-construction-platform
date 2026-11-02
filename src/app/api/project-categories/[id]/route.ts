import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("category", "GET", request, await context.params);
}
export async function PATCH(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("category", "PATCH", request, await context.params);
}
export async function DELETE(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("category", "DELETE", request, await context.params);
}
