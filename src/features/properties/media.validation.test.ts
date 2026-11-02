import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { FILE_LIMIT, mediaForm, mediaInput, mediaPage, normalizeImage } from "./media.validation";
const png = () => sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } }).png().toBuffer();
function request(form: FormData) { return new Request("http://localhost/api/upload", { method: "POST", body: form }); }
describe("actual image decoder", () => {
  it.each(["jpeg", "png", "webp"] as const)("decodes and normalizes %s bytes", async format => {
    const bytes = await sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } }).toFormat(format).withMetadata().toBuffer();
    const output = await normalizeImage(bytes, `image/${format}`);
    const metadata = await sharp(output.bytes).metadata();
    expect(metadata.format).toBe(format);expect(metadata.width).toBe(4);expect(metadata.height).toBe(3);expect(metadata.exif).toBeUndefined();expect(metadata.icc).toBeUndefined();expect(output.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects MIME spoofing, malformed bytes, empty and oversized images", async () => {
    for (const [bytes, mime] of [[await png(), "image/jpeg"], [Buffer.from('<svg><script>alert(1)</script></svg>'), "image/png"], [Buffer.alloc(0), "image/png"], [Buffer.alloc(FILE_LIMIT + 1), "image/png"], [(await png()).subarray(0, 40), "image/png"]] as const) await expect(normalizeImage(bytes, mime)).rejects.toThrow();
  });
  it("rejects excessive dimensions and decompressed pixel counts", async () => {
    const tooWide = await sharp({ create: { width: 10001, height: 1, channels: 3, background: "red" } }).png().toBuffer();
    await expect(normalizeImage(tooWide, "image/png")).rejects.toThrow();
    const tooMany = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: "red" } }).png().toBuffer();
    await expect(normalizeImage(tooMany, "image/png")).rejects.toThrow();
  });
  it("rejects real animated WebP frames", async () => {
    const animated = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(normalizeImage(animated, "image/webp")).rejects.toThrow();
  });
});
describe("bounded multipart", () => {
  it("ignores dangerous client filenames and parses exact metadata", async () => {
    const form = new FormData();form.append("file", new Blob([new Uint8Array(await png())], { type: "image/png" }), "../../unsafe.svg");form.append("is_primary", "false");form.append("display_order", "2");form.append("alt_text", "  Example  ");
    const result = await mediaForm(request(form), "images");expect(result.metadata).toEqual({ is_primary: false, display_order: 2, alt_text: "Example" });expect(result).not.toHaveProperty("filename");
  });
  it.each(["duplicate", "unknown", "file-metadata", "bad-primary", "bad-order"])("rejects %s before upload", async mode => {
    const form = new FormData();form.append("file", new Blob([new Uint8Array(await png())], { type: "image/png" }), "test.png");
    if (mode === "duplicate") form.append("file", new Blob(["x"]), "x");
    if (mode === "unknown") form.append("storage_path", "other/property");
    if (mode === "file-metadata") form.append("alt_text", new Blob(["bad"]));
    if (mode === "bad-primary") form.append("is_primary", "maybe");
    if (mode === "bad-order") form.append("display_order", "1e2");
    await expect(mediaForm(request(form), "images")).rejects.toThrow();
  });
  it("bounds a chunked body without trusting Content-Length", async () => {
    const req = new Request("http://localhost", { method: "POST", body: new Uint8Array(FILE_LIMIT + 65537), headers: { "Content-Type": "multipart/form-data; boundary=x" } });
    await expect(mediaForm(req, "images")).rejects.toMatchObject({ status: 413 });
  });
});
describe("metadata and pagination", () => {
  it.each([null, [], {}, { name: 2 }, { name: " " }, { name: "x", unknown: true }, { value: false }])("rejects invalid feature %j", body => expect(() => mediaInput(body, "features", true)).toThrow());
  it("preserves false, zero and optional null", () => expect(mediaInput({ is_primary: false, display_order: 0, alt_text: null }, "images")).toEqual({ is_primary: false, display_order: 0, alt_text: null }));
  it.each(["page=0", "limit=101", "page=1&page=2", "storage_path=x", "page=1e2"])("rejects %s", query => expect(() => mediaPage(new URLSearchParams(query))).toThrow());
});
