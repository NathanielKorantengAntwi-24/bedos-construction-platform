import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("public-project", "GET", request, await context.params);
}
