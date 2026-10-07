export type PropertyStatus =
  | "draft"
  | "published"
  | "reserved"
  | "sold"
  | "unavailable"
  | "archived";

export type Property = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  property_type: string;
  listing_type: string;
  price: number | null;
  currency: string;
  location: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor_area: number | null;
  land_area: number | null;
  status: PropertyStatus;
  featured: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PropertyListFilters = {
  search?: string;
  property_type?: string;
  listing_type?: string;
  city?: string;
  region?: string;
  featured?: boolean;
  page?: number;
  limit?: number;
};

export type CreatePropertyInput = {
  title: string;
  slug: string;
  description?: string | null;
  property_type: string;
  listing_type: string;
  price?: number | null;
  currency?: string;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floor_area?: number | null;
  land_area?: number | null;
  featured?: boolean;
};

export type UpdatePropertyInput = {
  title?: string;
  slug?: string;
  description?: string | null;
  property_type?: string;
  listing_type?: string;
  price?: number | null;
  currency?: string;
  location?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  floor_area?: number | null;
  land_area?: number | null;
  status?: PropertyStatus;
  featured?: boolean;
};