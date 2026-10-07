export type PropertyAmenity = {
  id: string;
  property_id: string;
  name: string;
  created_at: string;
};

export type CreatePropertyAmenityInput = {
  property_id: string;
  name: string;
};

export type UpdatePropertyAmenityInput = {
  name?: string;
};