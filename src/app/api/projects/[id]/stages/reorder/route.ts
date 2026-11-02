import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("reorder", "PATCH", request, await context.params);
}
