export type PropertyFeature = {
  id: string;
  property_id: string;
  name: string;
  value: string | null;
  created_at: string;
};

export type CreatePropertyFeatureInput = {
  property_id: string;
  name: string;
  value?: string | null;
};

export type UpdatePropertyFeatureInput = {
  name?: string;
  value?: string | null;
};