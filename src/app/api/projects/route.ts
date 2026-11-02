import { projectHandler } from "@/features/projects/project.routes";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return projectHandler("projects", "GET", request);
}
export async function POST(request: Request) {
  return projectHandler("projects", "POST", request);
}
