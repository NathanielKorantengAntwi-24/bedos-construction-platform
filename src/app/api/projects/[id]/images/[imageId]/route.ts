import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("image", "PATCH", request, await context.params);
}
export async function DELETE(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("image", "DELETE", request, await context.params);
}
