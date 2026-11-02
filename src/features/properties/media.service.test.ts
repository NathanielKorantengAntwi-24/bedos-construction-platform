import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mediaFile, propertyMediaService, retryMediaOperation } from "./media.service";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), download: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const actor = "11111111-1111-4111-8111-111111111111", property = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const op = { id, property_id: property, kind: "images", media_id: id, bucket_id: "property-images", storage_path: "server-owned-path", version: 1, lease_token: id, state: "upload_pending" };
const input = { metadata: {}, bytes: Buffer.from("test"), mime: "image/png", sha256: "a".repeat(64) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockReturnValue({ rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, download: mocks.download }) } });
  mocks.upload.mockResolvedValue({ error: null });mocks.remove.mockResolvedValue({ error: null });
});
describe("uncertain media operations", () => {
  it("does not delete an upload when finalization committed but its response was lost", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValueOnce({ data: { operation: op, acquired: true } }).mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValueOnce({ data: { ...op, state: "ready" } }).mockResolvedValueOnce({ data: { id, property_id: property } });
    const result = await propertyMediaService("images").upload(property, actor, input, id);
    expect(result).toMatchObject({ record: { id, image_url: `/api/properties/${property}/images/${id}/file` } });
    expect(mocks.remove).not.toHaveBeenCalled();logger.mockRestore();
  });
  it("returns a durable pending identity when upload outcome is uncertain", async () => {
    mocks.rpc.mockResolvedValue({ data: { operation: op, acquired: true } });mocks.upload.mockResolvedValue({ error: { message: "Private provider context" } });
    expect(await propertyMediaService("images").upload(property, actor, input, id)).toEqual({ pending: true, operation_id: id, state: "upload_pending" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not repeat Storage writes for a pending idempotency replay", async () => {
    mocks.rpc.mockResolvedValue({ data: { operation: op, acquired: false } });
    expect(await propertyMediaService("images").upload(property, actor, input, id)).toMatchObject({ pending: true });
    expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not describe a deleted idempotency replay as pending or resurrect its file", async () => {
    mocks.rpc.mockResolvedValue({ data: { operation: { ...op, state: "deleted" }, acquired: false } });
    await expect(propertyMediaService("images").upload(property, actor, input, id)).rejects.toMatchObject({ status: 409 });
    expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("retains pending deletion when removal fails", async () => {
    mocks.rpc.mockResolvedValue({ data: { operation: { ...op, state: "cleanup_pending" }, acquired: true } });mocks.remove.mockResolvedValue({ error: { message: "Private provider context" } });
    expect(await propertyMediaService("images").remove(property, actor, id)).toEqual({ pending: true, operation_id: id, state: "cleanup_pending" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not claim completed cleanup when its final database response is uncertain", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValueOnce({ data: { operation: { ...op, state: "cleanup_pending" }, acquired: true } }).mockRejectedValueOnce(new Error("Response lost"));
    expect(await retryMediaOperation(actor, id)).toMatchObject({ pending: true, operation_id: id });logger.mockRestore();
  });
});
describe("file delivery checks", () => {
  const bytes = Buffer.from("validated image bytes");
  const proof = { bucket_id: "property-images", storage_path: "server-owned-path", mime: "image/png", file_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  it("checks permission again after Storage read", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: proof }).mockResolvedValueOnce({ error: { code: "P0002" } });mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
    await expect(mediaFile(null, property, "images", id)).rejects.toMatchObject({ status: 404 });expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("refuses modified bytes even if Storage metadata exists", async () => {
    mocks.rpc.mockResolvedValue({ data: proof });mocks.download.mockResolvedValue({ data: new Blob(["tampered"]), error: null });
    await expect(mediaFile(null, property, "images", id)).rejects.toMatchObject({ status: 503 });
  });
});
