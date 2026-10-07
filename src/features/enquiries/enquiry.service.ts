import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import { createNotification } from "@/features/notifications/notification.service";
import type {
  CreateEnquiryInput,
  Enquiry,
  EnquiryStatus,
  EnquiryType,
  UpdateEnquiryInput,
} from "./enquiry.types";

const ENQUIRY_SELECT = `
  id,
  customer_id,
  enquiry_type,
  subject,
  message,
  property_id,
  product_id,
  service_id,
  status,
  assigned_to,
  created_at,
  updated_at
`;

const VALID_TYPES: EnquiryType[] = [
  "property_enquiry",
  "quote_request",
  "construction_request",
  "maintenance_request",
  "painting_request",
  "tiling_request",
  "interior_design_request",
  "product_enquiry",
  "general_contact",
];

const VALID_STATUSES: EnquiryStatus[] = [
  "new",
  "contacted",
  "in_progress",
  "completed",
];

const ALLOWED_TRANSITIONS: Record<
  EnquiryStatus,
  EnquiryStatus[]
> = {
  new: ["contacted"],
  contacted: ["in_progress"],
  in_progress: ["completed"],
  completed: [],
};

export async function createEnquiry(
  input: CreateEnquiryInput,
  customerId?: string | null,
) {
  const supabase = await createClient();

  if (!VALID_TYPES.includes(input.enquiry_type)) {
    throw new ApiError("Invalid enquiry type", 400);
  }

  const relationshipCount = [
    input.property_id,
    input.product_id,
    input.service_id,
  ].filter((value) => value !== undefined && value !== null).length;

  if (relationshipCount > 1) {
    throw new ApiError(
      "An enquiry can be linked to only one property, product, or service",
      400,
    );
  }

  if (input.property_id) {
    const { data, error } = await supabase
      .from("properties")
      .select("id, status")
      .eq("id", input.property_id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        throw new ApiError("Property not found", 404);
      }

      throw new ApiError(error.message, 500);
    }

    if (data.status !== "published") {
      throw new ApiError(
        "Enquiries can only be submitted for published properties",
        400,
      );
    }
  }

  if (input.product_id) {
    const { data, error } = await supabase
      .from("products")
      .select("id")
      .eq("id", input.product_id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        throw new ApiError("Product not found", 404);
      }

      throw new ApiError(error.message, 500);
    }

    if (!data) {
      throw new ApiError("Product not found", 404);
    }
  }

  if (input.service_id) {
    const { data, error } = await supabase
      .from("services")
      .select("id")
      .eq("id", input.service_id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        throw new ApiError("Service not found", 404);
      }

      throw new ApiError(error.message, 500);
    }

    if (!data) {
      throw new ApiError("Service not found", 404);
    }
  }

  const enquiryData = {
    customer_id: customerId ?? null,
    enquiry_type: input.enquiry_type,
    subject: input.subject ?? null,
    message: input.message ?? null,
    property_id: input.property_id ?? null,
    product_id: input.product_id ?? null,
    service_id: input.service_id ?? null,
  };

  if (!customerId) {
    const { error } = await supabase
      .from("enquiries")
      .insert(enquiryData);

    if (error) {
      throw new ApiError(error.message, 500);
    }

    return null;
  }

  const { data, error } = await supabase
    .from("enquiries")
    .insert(enquiryData)
    .select(ENQUIRY_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  const createdEnquiry = data as Enquiry;

  const adminSupabase = createAdminClient();

  const { data: staffProfiles, error: staffError } =
    await adminSupabase
      .from("profiles")
      .select(`
        id,
        roles (
          name
        )
      `)
      .eq("account_status", "active");

  if (staffError) {
    throw new ApiError(
      staffError.message,
      500,
    );
  }

  const staffRecipients = (staffProfiles ?? []).filter((profile) => {
    const role = Array.isArray(profile.roles)
      ? profile.roles[0]
      : profile.roles;

    return (
      role?.name === "administrator" ||
      role?.name === "sales_customer_service"
    );
  });

  for (const staff of staffRecipients) {
    try {
      await createNotification({
        recipient_id: staff.id,
        notification_type: "enquiry_created",
        title: "New enquiry received",
        message: `A new ${createdEnquiry.enquiry_type.replaceAll("_", " ")} has been submitted.`,
        channel: "in_app",
        related_entity_type: "enquiry",
        related_entity_id: createdEnquiry.id,
      });
    } catch (notificationError) {
      console.error(
        "Failed to create enquiry notification:",
        notificationError,
      );
    }
  }

  return createdEnquiry;
}

export async function listCustomerEnquiries(
  customerId: string,
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enquiries")
    .select(ENQUIRY_SELECT)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return (data ?? []) as Enquiry[];
}

export async function listEnquiries() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enquiries")
    .select(ENQUIRY_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return (data ?? []) as Enquiry[];
}

export async function getEnquiry(
  enquiryId: string,
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enquiries")
    .select(ENQUIRY_SELECT)
    .eq("id", enquiryId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new ApiError("Enquiry not found", 404);
    }

    throw new ApiError(error.message, 500);
  }

  return data as Enquiry;
}

type EnquiryUpdateActor = {
  userId: string;
  isStaff: boolean;
};

export async function updateEnquiry(
  enquiryId: string,
  input: UpdateEnquiryInput,
  actor: EnquiryUpdateActor,
) {
  const supabase = await createClient();

  const { data: existingEnquiry, error: existingError } =
    await supabase
      .from("enquiries")
      .select(`
        id,
        customer_id,
        status
      `)
      .eq("id", enquiryId)
      .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Enquiry not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (!actor.isStaff) {
    if (
      !existingEnquiry.customer_id ||
      existingEnquiry.customer_id !== actor.userId
    ) {
      throw new ApiError("Forbidden", 403);
    }

    if (existingEnquiry.status !== "new") {
      throw new ApiError(
        "Enquiries can only be edited before staff processing begins",
        403,
      );
    }

    if (
      input.status !== undefined ||
      input.assigned_to !== undefined
    ) {
      throw new ApiError(
        "Customers cannot change enquiry status or assignment",
        403,
      );
    }
  }

  if (
    input.status !== undefined &&
    !VALID_STATUSES.includes(input.status)
  ) {
    throw new ApiError("Invalid enquiry status", 400);
  }

  if (
    input.status !== undefined &&
    input.status !== existingEnquiry.status &&
    !ALLOWED_TRANSITIONS[
      existingEnquiry.status as EnquiryStatus
    ].includes(input.status)
  ) {
    throw new ApiError(
      `Invalid status transition from ${existingEnquiry.status} to ${input.status}`,
      400,
    );
  }

  if (input.assigned_to !== undefined && input.assigned_to !== null) {
    const adminSupabase = createAdminClient();

    const { data: assignedProfile, error: assignedProfileError } =
      await adminSupabase
        .from("profiles")
        .select(`
          id,
          account_status,
          roles (
            name
          )
        `)
        .eq("id", input.assigned_to)
        .single();

    if (assignedProfileError) {
      if (assignedProfileError.code === "PGRST116") {
        throw new ApiError("Assigned staff member not found", 404);
      }

      throw new ApiError(assignedProfileError.message, 500);
    }

    const assignedRole = Array.isArray(assignedProfile.roles)
      ? assignedProfile.roles[0]
      : assignedProfile.roles;

    if (
      assignedProfile.account_status !== "active" ||
      !assignedRole?.name ||
      !["administrator", "sales_customer_service"].includes(
        assignedRole.name,
      )
    ) {
      throw new ApiError(
        "Enquiries can only be assigned to active sales staff or administrators",
        400,
      );
    }
  }

  const updateData: UpdateEnquiryInput = {};

  if (input.subject !== undefined) {
    updateData.subject = input.subject;
  }

  if (input.message !== undefined) {
    updateData.message = input.message;
  }

  if (input.status !== undefined) {
    updateData.status = input.status;
  }

  if (input.assigned_to !== undefined) {
    updateData.assigned_to = input.assigned_to;
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError("No fields provided for update", 400);
  }

  if (!actor.isStaff) {
    const adminSupabase = createAdminClient();

    const { data, error } = await adminSupabase
      .from("enquiries")
      .update(updateData)
      .eq("id", enquiryId)
      .eq("customer_id", actor.userId)
      .eq("status", "new")
      .select(ENQUIRY_SELECT)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        throw new ApiError(
          "Enquiry is no longer editable",
          403,
        );
      }

      throw new ApiError(error.message, 500);
    }

    return data as Enquiry;
  }

  const { data, error } = await supabase
    .from("enquiries")
    .update(updateData)
    .eq("id", enquiryId)
    .select(ENQUIRY_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return data as Enquiry;
}

export async function deleteEnquiry(
  enquiryId: string,
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("enquiries")
    .delete()
    .eq("id", enquiryId)
    .select("id")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new ApiError("Enquiry not found", 404);
    }

    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError(
      "Enquiry could not be deleted",
      500,
    );
  }

  return data;
}