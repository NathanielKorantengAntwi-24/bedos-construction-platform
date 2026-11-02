import sharp from "sharp";
import { createHash } from "node:crypto";
import { ApiError } from "@/server/http/api-error";
export const FILE_LIMIT = 3 * 1024 * 1024;
function invalid(message: string): never { throw new ApiError(message, 400); }
export async function normalizeImage(bytes: Buffer, declaredType: string) {
  if (!bytes.length || bytes.length > FILE_LIMIT) invalid("Invalid image size.");
  // Reject other decoder families before invoking native parsing; magic alone is not validation.
  const signature = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "jpeg"
      : bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
  if (!signature) invalid("Unsupported image format.");
  try {
    const decoder = sharp(bytes, { limitInputPixels: 20000000, failOn: "warning" });
    const info = await decoder.metadata();
    const mime: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    if (!info.format || info.format !== signature || !mime[info.format] || !info.width || !info.height || info.width > 10000 || info.height > 10000 || info.width * info.height > 20000000 || (info.pages ?? 1) !== 1 || (declaredType && declaredType !== mime[info.format])) invalid("Unsupported or disguised image.");
    const output = await decoder.rotate().toFormat(info.format).toBuffer();
    if (output.length > FILE_LIMIT) throw new ApiError("Normalized image exceeds 3 MiB.", 413);
    return { bytes: output, mime: mime[info.format], sha256: createHash("sha256").update(output).digest("hex") };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    invalid("Malformed or unsupported image.");
  }
}
