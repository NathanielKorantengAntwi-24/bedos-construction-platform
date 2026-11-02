import { getUserContext } from "@/server/auth/get-user-context";
import { requirePermission } from "@/server/auth/require-permission";
import { ApiError } from "@/server/http/api-error";
import { catalogResponse, catalogError } from "@/features/services/catalog.http";
import { projectId, projectInput, projectJson, projectForm, projectQuery, noQuery, versioned, projectSlug, object, type Json, type Kind } from "./project.validation";
import { readProjects, mutateProject, uploadProjectImage, deleteProjectImage, editProjectImage, projectImageFile, retryProjectImage } from "./project.service";

export type ProjectRoute = "projects" | "project" | "status" | "categories" | "category" | "stages" | "stage" | "reorder" | "images" | "image" | "file" | "operations" | "retry" | "public-projects" | "public-project" | "public-categories";
async function staff(write: boolean, admin = false) {
  const context = await requirePermission(write ? "projects.manage" : "projects.view");
  if (!(admin ? ["administrator"] : ["administrator", "content_manager"]).includes(context.role?.name ?? "")) throw new ApiError("Forbidden", 403);return context.user.id;
}
async function preview() {
  const ctx = await getUserContext();return ctx?.profile.account_status === "active" && ["administrator", "content_manager"].includes(ctx.role?.name ?? "") ? ctx.user.id : null;
}
export async function projectHandler(route: ProjectRoute, method: string, request: Request, params: Record<string, string> = {}) {
  try {
    const isPublic = route.startsWith("public-"), file = route === "file";
    const actor = file ? await preview() : isPublic ? null : await staff(method !== "GET", ["operations", "retry"].includes(route));
    const id = params.id ? projectId(params.id) : undefined, child = params.stageId ? projectId(params.stageId) : params.imageId ? projectId(params.imageId) : undefined;
    if (file) { noQuery(request);return await projectImageFile(actor, id!, child!); }
    if (method === "GET") {
      if (["project", "category", "public-project"].includes(route)) {
        noQuery(request);const entity = route === "category" ? "categories" : "projects";
        return catalogResponse({ [route === "category" ? "category" : "project"]: await readProjects(actor, entity, {}, id, route === "public-project" ? projectSlug(params.slug) : undefined) });
      }
      const query = projectQuery(new URL(request.url).searchParams, isPublic, !["projects", "public-projects"].includes(route));
      if (["images", "stages"].includes(route)) {
        const detail = await readProjects<Json>(actor, "projects", {}, id), records = detail[route] as Json[], page = query.page as number, size = query.page_size as number;
        return catalogResponse({ [route]: records.slice((page - 1) * size, page * size), project_version: detail.version, pagination: { page, page_size: size, total: records.length } });
      }
      const entity = route.includes("categories") ? "categories" : route === "operations" ? "operations" : "projects";
      const result = await readProjects<{ records: Json[]; pagination: Json }>(actor, entity, query);return catalogResponse({ [entity]: result.records, pagination: result.pagination });
    }
    noQuery(request);
    if (route === "retry") {
      const body = object(await projectJson(request));if (Object.keys(body).length) throw new ApiError("Unexpected recovery fields.", 400);
      const result = await retryProjectImage(actor!, projectId(params.operationId));return catalogResponse(result, "pending" in result ? 202 : 200);
    }
    if (route === "images" && method === "POST") {
      const key = projectId(request.headers.get("idempotency-key")), form = await projectForm(request), result = await uploadProjectImage(actor!, id!, form, key);
      return catalogResponse(result, "pending" in result ? 202 : 201);
    }
    const body = object(await projectJson(request));
    if (route === "image") {
      const { version, input } = versioned(body, method === "PATCH" ? "image" : undefined);
      const result = method === "PATCH" ? await editProjectImage(actor!, id!, child!, version, input) : await deleteProjectImage(actor!, id!, child!, version);
      return catalogResponse(result, "pending" in result ? 202 : 200);
    }
    const kind: Kind = route === "categories" || route === "category" ? "category" : route === "status" ? "status" : route === "reorder" ? "reorder" : route === "stages" || route === "stage" ? "stage" : "project";
    const action = method === "POST" ? "create" : method === "DELETE" ? "delete" : "update";
    const create = action === "create" && kind !== "stage";
    const parsed = create ? { input: projectInput(body, kind, true), version: undefined } : kind === "stage" && action === "create" ? (() => { const { expected_version, ...rest } = body as Json;return { ...versioned({ expected_version }), input: projectInput(rest, "stage", true) }; })() : versioned(body, action === "delete" ? undefined : kind);
    const result = await mutateProject(actor!, kind, action, parsed.input, kind === "stage" ? child : id, ["stage", "reorder"].includes(kind) ? id : undefined, parsed.version);
    return catalogResponse({ [kind === "category" ? "category" : "project"]: result }, action === "create" ? 201 : 200);
  } catch (error) { return catalogError(error); }
}
