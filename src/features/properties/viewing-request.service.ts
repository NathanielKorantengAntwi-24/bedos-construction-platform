import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/server/http/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/features/notifications/notification.service";
import type {
  CreateViewingRequestInput,
  UpdateViewingRequestInput,
  ViewingRequest,
  ViewingRequestStatus,
} from "./viewing-request.types";

const VIEWING_REQUEST_SELECT = `
  id,
  property_id,
  customer_id,
  preferred_date,
  preferred_time,
  message,
  status,
  assigned_to,
  created_at,
  updated_at
`;

const VALID_STATUSES: ViewingRequestStatus[] = [
  "new",
  "contacted",
  "in_progress",
  "completed",
  "cancelled",
];

const ALLOWED_TRANSITIONS: Record<
  ViewingRequestStatus,
  ViewingRequestStatus[]
> = {
  new: ["contacted", "cancelled"],
  contacted: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export async function listPropertyViewingRequests(
  propertyId: string,
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("viewing_requests")
    .select(VIEWING_REQUEST_SELECT)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return (data ?? []) as ViewingRequest[];
}

export async function listCustomerViewingRequests(
  customerId: string,
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("viewing_requests")
    .select(VIEWING_REQUEST_SELECT)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ApiError(error.message, 500);
  }

  return (data ?? []) as ViewingRequest[];
}

export async function createViewingRequest(
  input: CreateViewingRequestInput,
  customerId: string,
) {
  const supabase = await createClient();

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("id, status")
    .eq("id", input.property_id)
    .single();

  if (propertyError) {
    if (propertyError.code === "PGRST116") {
      throw new ApiError("Property not found", 404);
    }

    throw new ApiError(propertyError.message, 500);
  }

  if (property.status !== "published") {
    throw new ApiError(
      "Viewing requests are only available for published properties",
      400,
    );
  }

  const { data, error } = await supabase
    .from("viewing_requests")
    .insert({
      property_id: input.property_id,
      customer_id: customerId,
      preferred_date: input.preferred_date ?? null,
      preferred_time: input.preferred_time ?? null,
      message: input.message ?? null,
    })
    .select(VIEWING_REQUEST_SELECT)
    .single();

  if (error) {
    if (error.code === "P0409") throw new ApiError("Property is no longer available for this request", 409);
    throw new ApiError(error.message, 500);
  }

  const viewingRequest = data as ViewingRequest;

  try {
    await createNotification({
      recipient_id: customerId,
      notification_type: "viewing_created",
      title: "Viewing request received",
      message:
        "Your property viewing request has been received and is awaiting processing.",
      channel: "in_app",
      related_entity_type: "viewing_request",
      related_entity_id: viewingRequest.id,
    });
  } catch (notificationError) {
    console.error(
      "Failed to create viewing request notification:",
      notificationError,
    );
  }

  return viewingRequest;
}

export async function getViewingRequest(
  propertyId: string,
  viewingRequestId: string,
) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("viewing_requests")
    .select(VIEWING_REQUEST_SELECT)
    .eq("id", viewingRequestId)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      throw new ApiError("Viewing request not found", 404);
    }

    throw new ApiError(error.message, 500);
  }

  if (data.property_id !== propertyId) {
    throw new ApiError(
      "Viewing request does not belong to this property",
      400,
    );
  }

  return data as ViewingRequest;
}

type ViewingRequestUpdateActor = {
  userId: string;
  isStaff: boolean;
};

export async function updateViewingRequest(
  propertyId: string,
  viewingRequestId: string,
  input: UpdateViewingRequestInput,
  actor: ViewingRequestUpdateActor,
) {
  const supabase = await createClient();

  const { data: existingRequest, error: existingError } =
    await supabase
      .from("viewing_requests")
      .select(`
  id,
  property_id,
  customer_id,
  status,
  assigned_to
`)
      .eq("id", viewingRequestId)
      .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Viewing request not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (existingRequest.property_id !== propertyId) {
    throw new ApiError(
      "Viewing request does not belong to this property",
      400,
    );
  }

  if (!actor.isStaff) {
    if (existingRequest.customer_id !== actor.userId) {
      throw new ApiError("Forbidden", 403);
    }

    if (existingRequest.status !== "new") {
      throw new ApiError(
        "Viewing requests can only be edited before staff processing begins",
        403,
      );
    }

    if (
      input.status !== undefined ||
      input.assigned_to !== undefined
    ) {
      throw new ApiError(
        "Customers can only edit the preferred date, preferred time, and message",
        403,
      );
    }
  }

  if (
    input.status !== undefined &&
    !VALID_STATUSES.includes(input.status)
  ) {
    throw new ApiError("Invalid viewing request status", 400);
  }

  if (
    input.status !== undefined &&
    input.status !== existingRequest.status &&
    !ALLOWED_TRANSITIONS[
      existingRequest.status as ViewingRequestStatus
    ].includes(input.status)
  ) {
    throw new ApiError(
      `Invalid status transition from ${existingRequest.status} to ${input.status}`,
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
        "Viewing requests can only be assigned to active sales staff or administrators",
        400,
      );
    }
  }

  const updateData: UpdateViewingRequestInput = {};

  if (input.preferred_date !== undefined) {
    updateData.preferred_date = input.preferred_date;
  }

  if (input.preferred_time !== undefined) {
    updateData.preferred_time = input.preferred_time;
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
    /*
     * Customers do not have a direct UPDATE RLS policy.
     * Use the service-role client only after the ownership and
     * status checks above have passed.
     */
    const adminSupabase = createAdminClient();

    const { data, error } = await adminSupabase
      .from("viewing_requests")
      .update(updateData)
      .eq("id", viewingRequestId)
      .eq("property_id", propertyId)
      .eq("customer_id", actor.userId)
      .eq("status", "new")
      .select(VIEWING_REQUEST_SELECT)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        throw new ApiError(
          "Viewing request is no longer editable",
          403,
        );
      }

      throw new ApiError(error.message, 500);
    }

    return data as ViewingRequest;
  }

  const { data, error } = await supabase
    .from("viewing_requests")
    .update(updateData)
    .eq("id", viewingRequestId)
    .select(VIEWING_REQUEST_SELECT)
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  const updatedRequest = data as ViewingRequest;

  const statusChanged =
  input.status !== undefined &&
  input.status !== existingRequest.status;

  const assignmentChanged =
  input.assigned_to !== undefined &&
  input.assigned_to !== existingRequest.assigned_to;

if (assignmentChanged && updatedRequest.assigned_to) {
    try {
      await createNotification({
        recipient_id: updatedRequest.assigned_to,
        notification_type: "viewing_assigned",
        title: "Viewing request assigned",
        message:
          "A property viewing request has been assigned to you.",
        channel: "in_app",
        related_entity_type: "viewing_request",
        related_entity_id: updatedRequest.id,
      });
    } catch (notificationError) {
      console.error(
        "Failed to create viewing assignment notification:",
        notificationError,
      );
    }
  }



  if (statusChanged) {
  try {
    await createNotification({
      recipient_id: updatedRequest.customer_id,
      notification_type: "viewing_updated",
      title: "Viewing request updated",
      message: `Your property viewing request status has been updated to ${updatedRequest.status}.`,
      channel: "in_app",
      related_entity_type: "viewing_request",
      related_entity_id: updatedRequest.id,
    });
  } catch (notificationError) {
    console.error(
      "Failed to create viewing status notification:",
      notificationError,
    );
  }
}
  if (
    statusChanged &&
    updatedRequest.status === "in_progress" &&
    updatedRequest.preferred_date &&
    updatedRequest.preferred_time
  ) {
    try {
      await createNotification({
        recipient_id: updatedRequest.customer_id,
        notification_type: "viewing_scheduled",
        title: "Viewing scheduled",
        message: `Your property viewing has been scheduled for ${updatedRequest.preferred_date} at ${updatedRequest.preferred_time}.`,
        channel: "in_app",
        related_entity_type: "viewing_request",
        related_entity_id: updatedRequest.id,
      });
    } catch (notificationError) {
      console.error(
        "Failed to create viewing scheduled notification:",
        notificationError,
      );
    }
  }

  return updatedRequest;
}


export async function deleteViewingRequest(
  propertyId: string,
  viewingRequestId: string,
) {
  const supabase = await createClient();

  const { data: existingRequest, error: existingError } =
    await supabase
      .from("viewing_requests")
      .select("id, property_id")
      .eq("id", viewingRequestId)
      .single();

  if (existingError) {
    if (existingError.code === "PGRST116") {
      throw new ApiError("Viewing request not found", 404);
    }

    throw new ApiError(existingError.message, 500);
  }

  if (existingRequest.property_id !== propertyId) {
    throw new ApiError(
      "Viewing request does not belong to this property",
      400,
    );
  }

  const { data, error } = await supabase
    .from("viewing_requests")
    .delete()
    .eq("id", viewingRequestId)
    .select("id")
    .single();

  if (error) {
    throw new ApiError(error.message, 500);
  }

  if (!data) {
    throw new ApiError(
      "Viewing request could not be deleted",
      500,
    );
  }
}
