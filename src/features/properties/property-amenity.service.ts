import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/server/http/api-error";
import type {
  CreatePropertyAmenityInput,
  PropertyAmenity,
  UpdatePropertyAmenityInput,
} from "./property-amenity.types";

const PROPERTY_AMENITY_SELECT = `
  id,
  property_id,
  name,
  created_at
`;

export async function listPropertyAmenities(propertyId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("property_amenities")
    .select(PROPERTY_AMENITY_SELECT)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return (data ?? []) as PropertyAmenity[];
}

export async function createPropertyAmenity(
  input: CreatePropertyAmenityInput,
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("property_amenities")
    .insert({
      property_id: input.property_id,
      name: input.name,
    })
    .select(PROPERTY_AMENITY_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return data as PropertyAmenity;
}

export async function updatePropertyAmenity(
  propertyId: string,
  amenityId: string,
  input: UpdatePropertyAmenityInput,
) {
  const supabase = await createClient();

  const { data: existingAmenity, error: existingError } = await supabase
    .from("property_amenities")
    .select("id, property_id")
    .eq("id", amenityId)
    .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Property amenity not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (existingAmenity.property_id !== propertyId) {
    throw new ApiError(
      "Property amenity does not belong to this property",
      400,
    );
  }

  const updateData: UpdatePropertyAmenityInput = {};

  if (input.name !== undefined) {
    updateData.name = input.name;
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError("No fields provided for update", 400);
  }

  const { data, error } = await supabase
    .from("property_amenities")
    .update(updateData)
    .eq("id", amenityId)
    .select(PROPERTY_AMENITY_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return data as PropertyAmenity;
}

export async function deletePropertyAmenity(
  propertyId: string,
  amenityId: string,
) {
  const supabase = await createClient();

  const { data: existingAmenity, error: existingError } = await supabase
    .from("property_amenities")
    .select("id, property_id")
    .eq("id", amenityId)
    .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Property amenity not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (existingAmenity.property_id !== propertyId) {
    throw new ApiError(
      "Property amenity does not belong to this property",
      400,
    );
  }

  const { data, error } = await supabase
    .from("property_amenities")
    .delete()
    .eq("id", amenityId)
    .select("id")
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError("Property amenity could not be deleted", 500);
  }
}