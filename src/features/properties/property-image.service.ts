import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import type {
  CreatePropertyImageInput,
  PropertyImage,
  UpdatePropertyImageInput,
} from "./property-image.types";

const PROPERTY_IMAGE_SELECT = `
  id,
  property_id,
  storage_path,
  alt_text,
  display_order,
  is_primary,
  created_at
`;

const SIGNED_URL_EXPIRES_IN = 60 * 60;

async function addSignedUrls(
  images: Omit<PropertyImage, "image_url">[],
) {
  if (images.length === 0) {
    return [];
  }

  const adminSupabase = createAdminClient();

  const signedImages = await Promise.all(
    images.map(async (image) => {
      const { data, error } = await adminSupabase.storage
        .from("property-images")
        .createSignedUrl(
          image.storage_path,
          SIGNED_URL_EXPIRES_IN,
        );

      if (error) {
        throw new ApiError(
          "Unable to generate property image URL",
          500,
        );
      }

      return {
        ...image,
        image_url: data.signedUrl,
      } as PropertyImage;
    }),
  );

  return signedImages;
}

export async function listPropertyImages(propertyId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("property_images")
    .select(PROPERTY_IMAGE_SELECT)
    .eq("property_id", propertyId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return addSignedUrls(
    (data ?? []) as Omit<PropertyImage, "image_url">[],
  );
}

export async function createPropertyImage(
  input: CreatePropertyImageInput,
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("property_images")
    .insert({
      property_id: input.property_id,
      storage_path: input.storage_path,
      alt_text: input.alt_text ?? null,
      display_order: input.display_order ?? 0,
      is_primary: input.is_primary ?? false,
    })
    .select(PROPERTY_IMAGE_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  const images = await addSignedUrls([
    data as Omit<PropertyImage, "image_url">,
  ]);

  return images[0];
}

export async function updatePropertyImage(
  propertyId: string,
  imageId: string,
  input: UpdatePropertyImageInput,
) {
  const supabase = await createClient();

  const { data: existingImage, error: existingError } = await supabase
    .from("property_images")
    .select("id, property_id")
    .eq("id", imageId)
    .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Property image not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (existingImage.property_id !== propertyId) {
    throw new ApiError(
      "Property image does not belong to this property",
      400,
    );
  }

  const updateData: UpdatePropertyImageInput = {};

  if (input.alt_text !== undefined) {
    updateData.alt_text = input.alt_text;
  }

  if (input.display_order !== undefined) {
    updateData.display_order = input.display_order;
  }

  if (input.is_primary !== undefined) {
    updateData.is_primary = input.is_primary;
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError("No fields provided for update", 400);
  }

  const { data, error } = await supabase
    .from("property_images")
    .update(updateData)
    .eq("id", imageId)
    .select(PROPERTY_IMAGE_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  const images = await addSignedUrls([
    data as Omit<PropertyImage, "image_url">,
  ]);

  return images[0];
}

export async function deletePropertyImage(
  propertyId: string,
  imageId: string,
) {
  const supabase = await createClient();

  const { data: existingImage, error: existingError } = await supabase
    .from("property_images")
    .select("id, property_id, storage_path")
    .eq("id", imageId)
    .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Property image not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (existingImage.property_id !== propertyId) {
    throw new ApiError(
      "Property image does not belong to this property",
      400,
    );
  }

  const { data, error } = await supabase
    .from("property_images")
    .delete()
    .eq("id", imageId)
    .select("id")
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError("Property image could not be deleted", 500);
  }

  const adminSupabase = createAdminClient();

  const { error: storageError } = await adminSupabase.storage
    .from("property-images")
    .remove([existingImage.storage_path]);

  if (storageError) {
    console.error(
      "Property image database record deleted, but storage cleanup failed:",
      storageError,
    );

    throw new ApiError(
      "Property image deleted, but storage cleanup failed",
      500,
    );
  }
}