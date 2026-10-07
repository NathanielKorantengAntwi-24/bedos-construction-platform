import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import type {
  CreatePropertyFloorPlanInput,
  PropertyFloorPlan,
  UpdatePropertyFloorPlanInput,
} from "./property-floor-plan.types";

const PROPERTY_FLOOR_PLAN_SELECT = `
  id,
  property_id,
  storage_path,
  title,
  description,
  display_order,
  created_at
`;

export async function listPropertyFloorPlans(propertyId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("property_floor_plans")
    .select(PROPERTY_FLOOR_PLAN_SELECT)
    .eq("property_id", propertyId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return addSignedUrls((data ?? []) as PropertyFloorPlan[]);
}

async function addSignedUrls(
  floorPlans: PropertyFloorPlan[],
) {
  if (floorPlans.length === 0) {
    return floorPlans;
  }

  const admin = createAdminClient();

  const results = await Promise.all(
    floorPlans.map(async (floorPlan) => {
      const { data, error } = await admin.storage
        .from("property-floor-plans")
        .createSignedUrl(floorPlan.storage_path, 3600);

      if (error) {
        console.error(
          `Failed to create signed URL for floor plan ${floorPlan.id}:`,
          error,
        );

        return {
          ...floorPlan,
          image_url: null,
        };
      }

      return {
        ...floorPlan,
        image_url: data.signedUrl,
      };
    }),
  );

  return results;
}

export async function createPropertyFloorPlan(
  input: CreatePropertyFloorPlanInput,
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("property_floor_plans")
    .insert({
      property_id: input.property_id,
      storage_path: input.storage_path,
      title: input.title ?? null,
      description: input.description ?? null,
      display_order: input.display_order ?? 0,
    })
    .select(PROPERTY_FLOOR_PLAN_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  const floorPlan = data as PropertyFloorPlan;
  const [result] = await addSignedUrls([floorPlan]);

  return result;
}

export async function updatePropertyFloorPlan(
  propertyId: string,
  floorPlanId: string,
  input: UpdatePropertyFloorPlanInput,
) {
  const supabase = await createClient();

  const { data: existingFloorPlan, error: existingError } =
    await supabase
      .from("property_floor_plans")
      .select("id, property_id")
      .eq("id", floorPlanId)
      .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Property floor plan not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (existingFloorPlan.property_id !== propertyId) {
    throw new ApiError(
      "Property floor plan does not belong to this property",
      400,
    );
  }

  const updateData: UpdatePropertyFloorPlanInput = {};

  if (input.title !== undefined) {
    updateData.title = input.title;
  }

  if (input.description !== undefined) {
    updateData.description = input.description;
  }

  if (input.display_order !== undefined) {
    updateData.display_order = input.display_order;
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError("No fields provided for update", 400);
  }

  const { data, error } = await supabase
    .from("property_floor_plans")
    .update(updateData)
    .eq("id", floorPlanId)
    .select(PROPERTY_FLOOR_PLAN_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  const [result] = await addSignedUrls([
    data as PropertyFloorPlan,
  ]);

  return result;
}

export async function deletePropertyFloorPlan(
  propertyId: string,
  floorPlanId: string,
) {
  const supabase = await createClient();

  const { data: existingFloorPlan, error: existingError } =
    await supabase
      .from("property_floor_plans")
      .select("id, property_id, storage_path")
      .eq("id", floorPlanId)
      .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Property floor plan not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (existingFloorPlan.property_id !== propertyId) {
    throw new ApiError(
      "Property floor plan does not belong to this property",
      400,
    );
  }

  const { data, error } = await supabase
    .from("property_floor_plans")
    .delete()
    .eq("id", floorPlanId)
    .select("id")
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError(
      "Property floor plan could not be deleted",
      500,
    );
  }

  const admin = createAdminClient();

  const { error: storageError } = await admin.storage
    .from("property-floor-plans")
    .remove([existingFloorPlan.storage_path]);

  if (storageError) {
    console.error(
      `Failed to delete floor plan storage object ${existingFloorPlan.storage_path}:`,
      storageError,
    );

    throw new ApiError(
      "Floor plan record was deleted, but the storage file could not be removed",
      500,
    );
  }
}