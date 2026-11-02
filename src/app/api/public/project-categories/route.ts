import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return projectHandler("public-categories", "GET", request);
}
