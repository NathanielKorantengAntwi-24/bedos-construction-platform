import { describe, expect, it } from "vitest";
import { catalogId, parseCatalogInput, parseCatalogQuery, publicServiceSlug } from "./catalog.validation";
const id = "ABCDEFAB-1111-4111-8111-111111111111";
describe("catalog runtime validation", () => {
  for (const value of [null, [], 7, "text", true]) {
    it(`rejects non-object body ${JSON.stringify(value)}`, () => expect(() => parseCatalogInput(value, false, true)).toThrow());
  }
  for (const value of [{}, { name: null, slug: "x" }, { name: 4, slug: "x" }, { name: [], slug: "x" }, { name: "x", slug: false }, { name: "  ", slug: "x" }, { name: "x", slug: "\0" }, { name: "x", slug: "x", description: {} }, { name: "x", slug: "x", featured: "false" }, { name: "x", slug: "x", featured: null }, { name: "x", slug: "x", category_id: 4 }, { name: "x", slug: "x", category_id: "bad" }, { name: "x", slug: "x", status: null }, { name: "x", slug: "x", status: "reserved" }, { name: "x", slug: "x", created_by: id }]) {
    it(`rejects invalid service body ${JSON.stringify(value)}`, () => expect(() => parseCatalogInput(value, false, true)).toThrow());
  }
  it("normalizes only supplied fields and preserves false/null/case", () => {
    expect(parseCatalogInput({ name: " N ", slug: " Mixed-Case ", description: "  ", category_id: id, featured: false, status: "draft" }, false, true)).toEqual({ name: "N", slug: "Mixed-Case", description: null, category_id: id.toLowerCase(), featured: false, status: "draft" });
    expect(parseCatalogInput({ category_id: null, description: null }, false, false)).toEqual({ category_id: null, description: null });
  });
  for (const key of ["name", "slug", "description"]) {
    it(`enforces ${key} length`, () => {
      const maximum = key === "description" ? 10000 : 200;
      expect(() => parseCatalogInput({ name: "n", slug: "s", [key]: "x".repeat(maximum + 1) }, false, true)).toThrow();
      expect(() => parseCatalogInput({ name: "n", slug: "s", [key]: "😀".repeat(maximum) }, false, true)).not.toThrow();
    });
  }
  it("rejects empty PATCH and category-only inappropriate fields", () => {
    expect(() => parseCatalogInput({}, false, false)).toThrow();
    for (const key of ["status", "featured", "category_id", "created_at"]) expect(() => parseCatalogInput({ name: "n", slug: "s", [key]: null }, true, true)).toThrow();
  });
  it("validates IDs and preserves exact public legacy slugs", () => {
    expect(catalogId(id)).toBe(id.toLowerCase());
    expect(() => catalogId("no-id")).toThrow();
    expect(publicServiceSlug("Old Mixed " + "x".repeat(220))).toBe("Old Mixed " + "x".repeat(220));
    expect(() => publicServiceSlug("bad\0slug")).toThrow();
  });
  for (const query of ["page=0", "page=-1", "page=01", "page=2147483648", "page=1.5", "page_size=101", "page_size=0", "page_size=1e2", "page_size=", "featured=1", "category_id=bad", "status=hidden", "q=" + "x".repeat(101), "q=%00", "page=1&page=2", "unknown=yes", "featured=false&featured=true"]) {
    it(`rejects query ${query.slice(0, 45)}`, () => expect(() => parseCatalogQuery(new URLSearchParams(query))).toThrow());
  }
  it("separates public and staff filters and binds literal search", () => {
    expect(() => parseCatalogQuery(new URLSearchParams("status=published"), false, true)).toThrow();
    expect(() => parseCatalogQuery(new URLSearchParams("featured=true"), true)).toThrow();
    expect(parseCatalogQuery(new URLSearchParams({ q: " %_,+()\\ ", page: "2", page_size: "100", featured: "false", category_id: id, status: "archived" }))).toEqual({ page: 2, page_size: 100, q: "%_,+()\\", featured: false, category_id: id.toLowerCase(), status: "archived" });
  });
});
