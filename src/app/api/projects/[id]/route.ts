import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("project", "GET", request, await context.params);
}
export async function PATCH(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("project", "PATCH", request, await context.params);
}
export async function DELETE(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("project", "DELETE", request, await context.params);
}
