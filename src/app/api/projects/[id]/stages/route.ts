import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("stages", "GET", request, await context.params);
}
export async function POST(request: Request, context: { params: Promise<Record<string, string>> }) {
  return projectHandler("stages", "POST", request, await context.params);
}
