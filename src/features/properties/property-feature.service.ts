import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/server/http/api-error";
import type {
  CreatePropertyFeatureInput,
  PropertyFeature,
  UpdatePropertyFeatureInput,
} from "./property-feature.types";

const PROPERTY_FEATURE_SELECT = `
  id,
  property_id,
  name,
  value,
  created_at
`;

export async function listPropertyFeatures(propertyId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("property_features")
    .select(PROPERTY_FEATURE_SELECT)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return (data ?? []) as PropertyFeature[];
}

export async function createPropertyFeature(
  input: CreatePropertyFeatureInput,
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("property_features")
    .insert({
      property_id: input.property_id,
      name: input.name,
      value: input.value ?? null,
    })
    .select(PROPERTY_FEATURE_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return data as PropertyFeature;
}

export async function updatePropertyFeature(
  propertyId: string,
  featureId: string,
  input: UpdatePropertyFeatureInput,
) {
  const supabase = await createClient();

  const { data: existingFeature, error: existingError } = await supabase
    .from("property_features")
    .select("id, property_id")
    .eq("id", featureId)
    .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Property feature not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (existingFeature.property_id !== propertyId) {
    throw new ApiError(
      "Property feature does not belong to this property",
      400,
    );
  }

  const updateData: UpdatePropertyFeatureInput = {};

  if (input.name !== undefined) {
    updateData.name = input.name;
  }

  if (input.value !== undefined) {
    updateData.value = input.value;
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError("No fields provided for update", 400);
  }

  const { data, error } = await supabase
    .from("property_features")
    .update(updateData)
    .eq("id", featureId)
    .select(PROPERTY_FEATURE_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return data as PropertyFeature;
}

export async function deletePropertyFeature(
  propertyId: string,
  featureId: string,
) {
  const supabase = await createClient();

  const { data: existingFeature, error: existingError } = await supabase
    .from("property_features")
    .select("id, property_id")
    .eq("id", featureId)
    .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Property feature not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (existingFeature.property_id !== propertyId) {
    throw new ApiError(
      "Property feature does not belong to this property",
      400,
    );
  }

  const { data, error } = await supabase
    .from("property_features")
    .delete()
    .eq("id", featureId)
    .select("id")
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError("Property feature could not be deleted", 500);
  }
}