import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("retry", "POST", request, await context.params);
}
