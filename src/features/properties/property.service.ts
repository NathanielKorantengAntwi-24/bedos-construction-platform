import { createClient } from "@/lib/supabase/server";
import type {
  CreatePropertyInput,
  Property,
  PropertyListFilters,
  UpdatePropertyInput,
} from "./property.types";
import { ApiError } from "@/server/http/api-error";

const PROPERTY_SELECT = `
  id,
  title,
  slug,
  description,
  property_type,
  listing_type,
  price,
  currency,
  location,
  address,
  city,
  region,
  bedrooms,
  bathrooms,
  floor_area,
  land_area,
  status,
  featured,
  created_by,
  created_at,
  updated_at
`;

export async function listPublishedProperties(
  filters: PropertyListFilters,
) {
  const supabase = await createClient();

  const page = filters.page ?? 1;
  const limit = filters.limit ?? 12;
  const offset = (page - 1) * limit;

  let query = supabase
    .from("properties")
    .select(PROPERTY_SELECT, { count: "exact" })
    .eq("status", "published")
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.search) {
    const search = filters.search.trim();

    if (search) {
      query = query.or(
        `title.ilike.%${search}%,location.ilike.%${search}%,city.ilike.%${search}%`,
      );
    }
  }

  if (filters.property_type) {
    query = query.eq("property_type", filters.property_type);
  }

  if (filters.listing_type) {
    query = query.eq("listing_type", filters.listing_type);
  }

  if (filters.city) {
    query = query.eq("city", filters.city);
  }

  if (filters.region) {
    query = query.eq("region", filters.region);
  }

  if (filters.featured !== undefined) {
    query = query.eq("featured", filters.featured);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return {
    properties: (data ?? []) as Property[],
    pagination: {
      page,
      limit,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / limit),
    },
  };
}

export async function createProperty(
  input: CreatePropertyInput,
  userId: string,
) {
  const supabase = await createClient();

  const { data: insertedProperty, error: insertError } = await supabase
    .from("properties")
    .insert({
      title: input.title,
      slug: input.slug,
      description: input.description ?? null,
      property_type: input.property_type,
      listing_type: input.listing_type,
      price: input.price ?? null,
      currency: input.currency ?? "GHS",
      location: input.location ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      bedrooms: input.bedrooms ?? null,
      bathrooms: input.bathrooms ?? null,
      floor_area: input.floor_area ?? null,
      land_area: input.land_area ?? null,
      featured: input.featured ?? false,
      created_by: userId,
      status: "draft",
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  const { data, error } = await supabase
    .from("properties")
    .select(PROPERTY_SELECT)
    .eq("id", insertedProperty.id)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Property;
}

export async function getPropertyById(id: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("properties")
    .select(PROPERTY_SELECT)
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new ApiError("Property not found", 404);
    }

    throw new ApiError(error.message, 500);
  }

  return data as Property;
}

export async function updateProperty(
  id: string,
  input: UpdatePropertyInput,
) {
  const supabase = await createClient();

  const updateData: UpdatePropertyInput = {};

  if (input.title !== undefined) updateData.title = input.title;
  if (input.slug !== undefined) updateData.slug = input.slug;
  if (input.description !== undefined)
    updateData.description = input.description;
  if (input.property_type !== undefined)
    updateData.property_type = input.property_type;
  if (input.listing_type !== undefined)
    updateData.listing_type = input.listing_type;
  if (input.price !== undefined) updateData.price = input.price;
  if (input.currency !== undefined) updateData.currency = input.currency;
  if (input.location !== undefined) updateData.location = input.location;
  if (input.address !== undefined) updateData.address = input.address;
  if (input.city !== undefined) updateData.city = input.city;
  if (input.region !== undefined) updateData.region = input.region;
  if (input.bedrooms !== undefined) updateData.bedrooms = input.bedrooms;
  if (input.bathrooms !== undefined) updateData.bathrooms = input.bathrooms;
  if (input.floor_area !== undefined)
    updateData.floor_area = input.floor_area;
  if (input.land_area !== undefined) updateData.land_area = input.land_area;
  if (input.status !== undefined) updateData.status = input.status;
  if (input.featured !== undefined) updateData.featured = input.featured;

  if (Object.keys(updateData).length === 0) {
    throw new Error("No fields provided for update");
  }

  const { data, error } = await supabase
    .from("properties")
    .update(updateData)
    .eq("id", id)
    .select(PROPERTY_SELECT)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Property;
}

export async function deleteProperty(id: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("properties")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    throw new ApiError(error.message, 500);
  }

  if (!data || data.length === 0) {
    throw new ApiError("Property could not be deleted", 403);
  }
}