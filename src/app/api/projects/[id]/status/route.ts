import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("status", "PATCH", request, await context.params);
}
