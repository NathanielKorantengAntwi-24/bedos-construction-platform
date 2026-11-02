import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as images, POST as upload } from "../properties/[id]/images/route";
import { PATCH as imageEdit, DELETE as imageDelete } from "../properties/[id]/images/[imageId]/route";
import { GET as imageFile } from "../properties/[id]/images/[imageId]/file/route";
import { GET as plans, POST as planUpload } from "../properties/[id]/floor-plans/route";
import { PATCH as planEdit, DELETE as planDelete } from "../properties/[id]/floor-plans/[floorPlanId]/route";
import { GET as features, POST as featureCreate } from "../properties/[id]/features/route";
import { PATCH as featureEdit, DELETE as featureDelete } from "../properties/[id]/features/[featureId]/route";
import { GET as amenities, POST as amenityCreate } from "../properties/[id]/amenities/route";
import { PATCH as amenityEdit, DELETE as amenityDelete } from "../properties/[id]/amenities/[amenityId]/route";
import { GET as operations } from "./operations/route";
import { POST as retry } from "./operations/[operationId]/retry/route";
import { ApiError } from "@/server/http/api-error";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), context: vi.fn(), rpc: vi.fn(), admin: vi.fn() }));
vi.mock("@/server/auth/require-permission", () => ({ requirePermission: mocks.permission }));
vi.mock("@/server/auth/get-user-context", () => ({ getUserContext: mocks.context }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const actor = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ id, imageId: id, floorPlanId: id, featureId: id, amenityId: id }) };
const req = (method: string, body?: string, query = "") => new Request("http://localhost/api/property-media" + query, { method, ...(body !== undefined ? { body } : {}) });
beforeEach(() => {
  vi.resetAllMocks();mocks.permission.mockResolvedValue({ user: { id: actor } });mocks.context.mockResolvedValue(null);mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { id, property_id: id, records: [], pagination: { page: 1, limit: 25, total: 0 } }, error: null });
});
describe("media route boundaries", () => {
  const protectedRoutes = [
    () => upload(req("POST", "malformed"), context), () => planUpload(req("POST", "malformed"), context),
    () => featureCreate(req("POST", '{"name":"Feature"}'), context), () => amenityCreate(req("POST", '{"name":"Amenity"}'), context),
    () => imageEdit(req("PATCH", '{"is_primary":true}'), context), () => planEdit(req("PATCH", '{"title":"Plan"}'), context),
    () => featureEdit(req("PATCH", '{"name":"Feature"}'), context), () => amenityEdit(req("PATCH", '{"name":"Amenity"}'), context),
    () => imageDelete(req("DELETE"), context), () => planDelete(req("DELETE"), context), () => featureDelete(req("DELETE"), context), () => amenityDelete(req("DELETE"), context),
    () => operations(req("GET")), () => retry(req("POST"), { params: Promise.resolve({ operationId: id }) }),
  ];
  protectedRoutes.forEach((call, index) => {
    for (const status of [401, 403]) it(`protected route ${index} rejects ${status} before body/storage work`, async () => {
      mocks.permission.mockRejectedValue(new ApiError("Denied", status));const response = await call();
      expect(response.status).toBe(status);expect(response.headers.get("cache-control")).toBe("no-store");expect(mocks.admin).not.toHaveBeenCalled();
    });
  });
  for (const handler of [images, plans, features, amenities]) {
    it("anonymous metadata sends only a public actor and bounded defaults", async () => {
      expect((await handler(req("GET"), context)).status).toBe(200);
      expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_actor: null, p_property: id, p_page: 1, p_limit: 25 });
    });
    it("repeated pagination rejected before privileged calls", async () => {
      expect((await handler(req("GET", undefined, "?page=1&page=2"), context)).status).toBe(400);expect(mocks.admin).not.toHaveBeenCalled();
    });
  }
  it("metadata edits use verified actor and reject caller-selected paths", async () => {
    expect((await imageEdit(req("PATCH", '{"alt_text":"Valid"}'), context)).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_actor: actor, p_property: id, p_id: id, p_input: { alt_text: "Valid" } });
    mocks.rpc.mockClear();expect((await imageEdit(req("PATCH", '{"storage_path":"another/path"}'), context)).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("malformed JSON and wrong IDs are client errors", async () => {
    expect((await featureCreate(req("POST", "{"), context)).status).toBe(400);
    expect((await imageFile(req("GET"), { params: Promise.resolve({ id: "bad", imageId: id }) })).status).toBe(400);expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("retry refuses arbitrary fields and bounds request bytes", async () => {
    const ctx = { params: Promise.resolve({ operationId: id }) };
    expect((await retry(req("POST", '{"bucket":"other"}'), ctx)).status).toBe(400);
    expect((await retry(req("POST", " ".repeat(1025)), ctx)).status).toBe(413);expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("recovery endpoint maps the database's administrator-only denial", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Private database detail" } });
    const response = await operations(req("GET"));expect(response.status).toBe(403);expect(await response.text()).not.toContain("Private database detail");
  });
});
