import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return projectHandler("operations", "GET", request);
}
