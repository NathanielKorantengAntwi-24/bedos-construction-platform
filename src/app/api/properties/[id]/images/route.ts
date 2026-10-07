import { NextResponse } from "next/server";
import {
  createPropertyImage,
  listPropertyImages,
} from "@/features/properties/property-image.service";
import { errorResponse } from "@/server/http/api-error";
import { requirePermission } from "@/server/auth/require-permission";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function getFileExtension(file: File) {
  const extensionMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  return extensionMap[file.type];
}

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { error: "Invalid property ID" },
        { status: 400 },
      );
    }

    const images = await listPropertyImages(id);

    return NextResponse.json({
      images,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
) {
  try {
    await requirePermission("properties.manage");

    const { id } = await context.params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { error: "Invalid property ID" },
        { status: 400 },
      );
    }

    const formData = await request.formData();

    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Image file is required" },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          error: "Only JPEG, PNG, and WebP images are allowed",
        },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "Image file is empty" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: "Image file must not exceed 10 MB",
        },
        { status: 400 },
      );
    }

    const adminSupabase = createAdminClient();

    const { data: property, error: propertyError } = await adminSupabase
      .from("properties")
      .select("id, slug")
      .eq("id", id)
      .single();

    if (propertyError || !property) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 },
      );
    }

    const extension = getFileExtension(file);

    if (!extension) {
      return NextResponse.json(
        { error: "Unsupported image type" },
        { status: 400 },
      );
    }

    const filename = `${crypto.randomUUID()}.${extension}`;
    const storagePath = `properties/${property.slug}/${filename}`;

    const { error: uploadError } = await adminSupabase.storage
      .from("property-images")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        {
          error: "Unable to upload image",
        },
        { status: 500 },
      );
    }

    const altText = formData.get("alt_text");
    const displayOrderValue = formData.get("display_order");
    const isPrimaryValue = formData.get("is_primary");

    const displayOrder =
      displayOrderValue !== null
        ? Number(displayOrderValue)
        : 0;

    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      await adminSupabase.storage
        .from("property-images")
        .remove([storagePath]);

      return NextResponse.json(
        {
          error: "display_order must be a non-negative integer",
        },
        { status: 400 },
      );
    }

    const isPrimary =
      isPrimaryValue === "true";

    try {
      const image = await createPropertyImage({
        property_id: id,
        storage_path: storagePath,
        alt_text:
          typeof altText === "string" && altText.trim()
            ? altText.trim()
            : null,
        display_order: displayOrder,
        is_primary: isPrimary,
      });

      return NextResponse.json(
        {
          image,
          message: "Property image uploaded successfully",
        },
        { status: 201 },
      );
    } catch (error) {
      await adminSupabase.storage
        .from("property-images")
        .remove([storagePath]);

      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}