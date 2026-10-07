export type PropertyFloorPlan = {
  id: string;
  property_id: string;
  storage_path: string;
  image_url: string | null;
  title: string | null;
  description: string | null;
  display_order: number;
  created_at: string;
};

export type CreatePropertyFloorPlanInput = {
  property_id: string;
  storage_path: string;
  title?: string | null;
  description?: string | null;
  display_order?: number;
};

export type UpdatePropertyFloorPlanInput = {
  title?: string | null;
  description?: string | null;
  display_order?: number;
};