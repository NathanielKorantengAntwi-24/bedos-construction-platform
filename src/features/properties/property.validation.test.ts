import { describe, expect, it } from "vitest";
import { parsePropertyInput, parsePropertyQuery, parsePropertyStatus, propertyId } from "./property.validation";
const base = { title: " House ", slug: "house", property_type: "house", listing_type: "sale" };
describe("property input boundary", () => {
  it("normalizes permitted fields without accepting lifecycle or actor fields", () => {
    expect(parsePropertyInput({ ...base, price: 20.25, bedrooms: 0, featured: false, description: " " }, true)).toEqual({ ...base, title: "House", price: 20.25, bedrooms: 0, featured: false, description: null });
    expect(parsePropertyInput({ price: null }, false)).toEqual({ price: null });
  });
  it.each([null, [], {}, { title: 1 }, { ...base, status: "published" }, { ...base, created_by: "actor" }, { ...base, slug: "bad,slug" }, { ...base, currency: "ghs" }, { ...base, featured: "true" }, { ...base, title: "\0" }, { ...base, title: "x".repeat(201) }])("rejects malformed creation %j", body => {
    expect(() => parsePropertyInput(body, true)).toThrow();
  });
  it.each([{ price: -1 }, { price: Infinity }, { price: 0.001 }, { price: 1000000000000 }, { floor_area: 10000000000 }, { bedrooms: 1.5 }, { bathrooms: 2147483648 }, { status: "sold" }, { unknown: true }, {}])("rejects invalid partial edit %j", body => {
    expect(() => parsePropertyInput(body, false)).toThrow();
  });
  it("requires status precondition and reason", () => {
    expect(parsePropertyStatus({ status: "reserved", expected_status: "published", reason: " review " }).reason).toBe("review");
    for (const body of [{ status: "sold" }, { status: "rented", expected_status: "published", reason: "review" }, { status: "sold", expected_status: "published", reason: " " }, { status: "sold", expected_status: "published", reason: "review", actor: "x" }]) expect(() => parsePropertyStatus(body)).toThrow();
  });
});
describe("property filters", () => {
  it("retains defaults and literal search characters", () => {
    expect(parsePropertyQuery(new URLSearchParams())).toEqual({ page: 1, limit: 12 });
    expect(parsePropertyQuery(new URLSearchParams({ search: "%,(x)", min_price: "0", max_price: "100.50", min_bedrooms: "2", featured: "false" }))).toMatchObject({ search: "%,(x)", min_price: 0, max_price: 100.5, min_bedrooms: 2, featured: false });
    expect(parsePropertyQuery(new URLSearchParams("status=archived"), true).status).toBe("archived");
  });
  it.each(["page=1e2", "page=0", "page=2147483648", "limit=101", "page=1&page=2", "unknown=x", "status=draft", "min_price=2&max_price=1", "min_bedrooms=1.5", "min_price=-1", "max_bathrooms=2147483648", "featured=1", "search=%00", "city="])("rejects invalid query %s", query => expect(() => parsePropertyQuery(new URLSearchParams(query))).toThrow());
  it("validates record IDs", () => {
    expect(propertyId("ABCDEFAB-1234-1234-1234-ABCDEFABCDEF")).toBe("abcdefab-1234-1234-1234-abcdefabcdef");
    expect(() => propertyId("bad")).toThrow();
  });
});
