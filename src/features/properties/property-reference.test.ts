import { beforeEach, describe, expect, it, vi } from "vitest";
import { createViewingRequest } from "./viewing-request.service";
import { createEnquiry } from "@/features/enquiries/enquiry.service";
const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/features/notifications/notification.service", () => ({ createNotification: mocks.notify }));
const propertyId = "11111111-1111-4111-8111-111111111111", customerId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  const rejected = { data: null, error: { code: "P0409", message: "Private trigger context" } };
  const inserted = { select: () => ({ single: async () => rejected }), then: (resolve: (value: unknown) => unknown) => Promise.resolve(rejected).then(resolve) };
  mocks.client.mockResolvedValue({ from: (table: string) => table === "properties"
    ? { select: () => ({ eq: () => ({ single: async () => ({ data: { id: propertyId, status: "published" }, error: null }) }) }) }
    : { insert: () => inserted } });
});
describe("property publication races", () => {
  const operations = [
    { name: "viewing", call: () => createViewingRequest({ property_id: propertyId }, customerId) },
    { name: "customer enquiry", call: () => createEnquiry({ enquiry_type: "property_enquiry", property_id: propertyId }, customerId) },
    { name: "anonymous enquiry", call: () => createEnquiry({ enquiry_type: "property_enquiry", property_id: propertyId }) },
  ];
  for (const operation of operations) it(`${operation.name} maps withdrawal after its initial read to safe 409`, async () => {
    await expect(operation.call()).rejects.toMatchObject({ status: 409, message: "Property is no longer available for this request" });
    expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.notify).not.toHaveBeenCalled();
  });
});
