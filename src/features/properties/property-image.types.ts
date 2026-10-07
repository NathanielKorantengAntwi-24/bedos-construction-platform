export type PropertyImage = {
  id: string;
  property_id: string;
  storage_path: string;
  image_url: string | null;
  alt_text: string | null;
  display_order: number;
  is_primary: boolean;
  created_at: string;
};

export type CreatePropertyImageInput = {
  property_id: string;
  storage_path: string;
  alt_text?: string | null;
  display_order?: number;
  is_primary?: boolean;
};

export type UpdatePropertyImageInput = {
  alt_text?: string | null;
  display_order?: number;
  is_primary?: boolean;
};