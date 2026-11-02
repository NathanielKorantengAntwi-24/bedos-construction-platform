import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, download: mocks.download }) } }) }));
import { projectRpc, uploadProjectImage, deleteProjectImage, projectImageFile } from "./project.service";
const op = { id: "op", project_id: "p", media_id: "m", bucket_id: "project-images", storage_path: "owned", version: 1, lease_token: "lease", state: "upload_pending" };
const form = { version: 1, input: { phase: "before" }, bytes: Buffer.from("image"), mime: "image/png", sha256: "a".repeat(64) };
const reply = (data: unknown) => ({ data, error: null });
beforeEach(() => { vi.resetAllMocks(); });
describe("construction file orchestration", () => {
  it.each([["42501", 403], ["22023", 400], ["23514", 400], ["P0002", 404], ["23503", 409], ["P0001", 409], ["40001", 409]])("maps %s to safe HTTP %i", async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE DATABASE CONTENT" } });await expect(projectRpc("test", {})).rejects.toMatchObject({ status });
  });
  it("reconciles a lost finalize response without deleting a committed image", async () => {
    mocks.rpc.mockResolvedValueOnce(reply({ operation: op, acquired: true })).mockRejectedValueOnce(Error("lost ack")).mockResolvedValueOnce(reply({ ...op, state: "ready" })).mockResolvedValueOnce(reply({ version: 3, images: [{ id: "m", image_url: "/owned" }] }));mocks.upload.mockResolvedValue({ error: null });
    expect(await uploadProjectImage("actor", "p", form, "key")).toEqual({ image: { id: "m", image_url: "/owned" }, project_version: 3 });expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("leaves uncertain uploads pending with no metadata exposure", async () => {
    mocks.rpc.mockResolvedValueOnce(reply({ operation: op, acquired: true }));mocks.upload.mockResolvedValue({ error: { message: "provider down" } });
    expect(await uploadProjectImage("actor", "p", form, "key")).toEqual({ pending: true, operation_id: "op", state: "upload_pending" });expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not upload again on ready idempotent replay", async () => {
    mocks.rpc.mockResolvedValueOnce(reply({ operation: { ...op, state: "ready" }, acquired: false })).mockResolvedValueOnce(reply({ version: 4, images: [{ id: "m" }] }));await uploadProjectImage("actor", "p", form, "key");expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("preserves cleanup intent on provider delete failure", async () => {
    mocks.rpc.mockResolvedValueOnce(reply({ operation: { ...op, state: "cleanup_pending" }, acquired: true }));mocks.remove.mockResolvedValue({ error: {} });expect(await deleteProjectImage("actor", "p", "m", 1)).toMatchObject({ pending: true, state: "cleanup_pending" });expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("rechecks visibility after downloading before sending any bytes", async () => {
    const { createHash } = await import("node:crypto"), bytes = Buffer.from("image");mocks.rpc.mockResolvedValueOnce(reply({ bucket_id: "project-images", storage_path: "owned", mime: "image/png", file_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })).mockResolvedValueOnce({ data: null, error: { code: "P0002" } });mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
    await expect(projectImageFile(null, "p", "m")).rejects.toMatchObject({ status: 404 });expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it("rejects corrupted provider content before a response", async () => {
    mocks.rpc.mockResolvedValueOnce(reply({ bucket_id: "project-images", storage_path: "owned", mime: "image/png", file_size: 5, sha256: "a".repeat(64) }));mocks.download.mockResolvedValue({ data: new Blob(["image"]), error: null });await expect(projectImageFile(null, "p", "m")).rejects.toMatchObject({ status: 503 });
  });
});
