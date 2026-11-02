import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { projectInput, projectQuery, projectForm, projectJson, versioned, date } from "./project.validation";
describe("construction input boundaries", () => {
  it("normalizes text, nullable fields and reference identities", () => {
    expect(projectInput({ title: " Work ", slug: "work", client_name: "", service_ids: ["AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"] }, "project", true)).toEqual({ title: "Work", slug: "work", client_name: null, service_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"] });
  });
  it.each([null, [], { progress: 100 }, { status: "ongoing" }, { actor_id: "x" }, { title: 5 }, { title: " " }, { slug: "Bad slug" }, { category_id: "bad" }, { service_ids: [null] }, { featured: "true" }, { description: "x".repeat(10001) }, { client_name: "x".repeat(501) }])("rejects malformed/protected project fields %j", input => { expect(() => projectInput(input, "project")).toThrow(); });
  it.each(["2026-02-29", "0000-01-01", "2026-04-31", "2026-1-01", "2026-01-01T00:00:00Z"])("rejects invalid calendar date %s", input => expect(() => date(input)).toThrow());
  it("accepts leap dates and catches equivalent duplicate UUIDs", () => {
    expect(date("2000-02-29")).toBe("2000-02-29");expect(() => projectInput({ service_ids: ["AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"] }, "project")).toThrow();
  });
  it("enforces stage initial state and fields", () => {
    expect(projectInput({ name: "Foundation", stage_order: 0 }, "stage", true)).toEqual({ name: "Foundation", stage_order: 0 });
    for (const input of [{ name: "X", stage_order: -1 }, { name: "X", stage_order: 0, status: "completed" }, { name: "X", stage_order: 0, start_date: "2026-01-01" }]) expect(() => projectInput(input, "stage", true)).toThrow();
  });
  it("requires explicit positive versions and rejects delete extras", () => {
    for (const value of [undefined, 0, "1", 1.1]) expect(() => versioned({ expected_version: value })).toThrow();
    expect(() => versioned({ expected_version: 1, actor_id: "bad" })).toThrow();expect(versioned({ expected_version: 2, title: "New" }, "project")).toEqual({ version: 2, input: { title: "New" } });
  });
  it.each(["page=0", "page_size=101", "page=1&page=2", "q=", "status=draft", "featured=1", "service_id=bad", "actor=admin"])("rejects unsafe public query %s", query => expect(() => projectQuery(new URLSearchParams(query), true)).toThrow());
  it("validates public combined filters and category pagination", () => {
    expect(projectQuery(new URLSearchParams("status=completed&featured=false&page=2"), true)).toEqual({ page: 2, page_size: 25, featured: false, status: "completed" });expect(() => projectQuery(new URLSearchParams("q=ignored"), false, true)).toThrow();
  });
});
describe("bounded construction request parsing", () => {
  it("rejects malformed and oversized JSON streams", async () => {
    await expect(projectJson(new Request("http://localhost", { method: "POST", body: "{" }))).rejects.toThrow();
    await expect(projectJson(new Request("http://localhost", { method: "POST", body: "x".repeat(128 * 1024 + 1) }))).rejects.toThrow();
  });
  it("decodes image bytes and discards client filename", async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().withMetadata().toBuffer();
    const form = new FormData();form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "../../unsafe.svg");form.append("expected_version", "3");form.append("phase", "before");
    const result = await projectForm(new Request("http://localhost", { method: "POST", body: form }));expect(result.version).toBe(3);expect(result.input).toEqual({ phase: "before" });expect(result).not.toHaveProperty("filename");expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
  });
  it.each(["missing-version", "unknown", "duplicate", "invalid-phase", "spoofed", "missing-key-field"])("rejects malformed upload %s", async mode => {
    const form = new FormData();form.append("file", new Blob(["<svg/>"], { type: "image/png" }), "x.png");
    if (mode !== "missing-version") form.append("expected_version", "1");if (mode !== "missing-key-field") form.append("phase", mode === "invalid-phase" ? "other" : "before");
    if (mode === "duplicate") form.append("phase", "after");if (mode === "unknown") form.append("storage_path", "someone-else");
    await expect(projectForm(new Request("http://localhost", { method: "POST", body: form }))).rejects.toThrow();
  });
});
