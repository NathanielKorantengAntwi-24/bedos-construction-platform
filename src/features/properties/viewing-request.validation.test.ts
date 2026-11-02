import { describe, expect, it } from "vitest";
import { parseViewingInput, parseViewingQuery, viewingDeleteQuery, viewingJson } from "./viewing-request.validation";
describe("viewing runtime contracts", () => {
  for (const body of [null, [], "text", 2, { customer_id: "caller" }, { status: "new" }, { message: 2 }, { message: true }, { message: "\0" }, { message: "😀".repeat(2001) }, { preferred_date: "2026-02-29" }, { preferred_date: "1900-02-29" }, { preferred_date: "2026-04-31" }, { preferred_date: "0000-01-01" }, { preferred_date: "2026-13-01" }, { preferred_time: "24:00" }, { preferred_time: "10:60" }, { preferred_time: "10:10:60" }, { preferred_time: "10:10Z" }]) {
    it("rejects invalid customer fields " + JSON.stringify(body).slice(0, 65), () => expect(() => parseViewingInput(body, true)).toThrow());
  }
  it("normalizes valid civil values without timezone conversion", () => {
    expect(parseViewingInput({ preferred_date: "2000-02-29", preferred_time: "23:59", message: "  Hello  " }, true)).toEqual({ preferred_date: "2000-02-29", preferred_time: "23:59:00", message: "Hello" });
    expect(parseViewingInput({ preferred_date: "0001-01-01", message: "  " }, true)).toEqual({ preferred_date: "0001-01-01", message: null });
  });
  for (const body of [{}, { expected_version: 1 }, { expected_version: "1", message: "a" }, { expected_version: 0, message: "a" }, { expected_version: 1.5, message: "a" }, { expected_version: 2147483648, message: "a" }, { expected_version: 1, status: "in_progress" }, { expected_version: 1, assigned_to: "staff" }, { expected_version: 1, status: null }]) {
    it("requires a versioned valid edit " + JSON.stringify(body), () => expect(() => parseViewingInput(body, false)).toThrow());
  }
  it("permits canonical cancellation and explicit nullable preferences", () => expect(parseViewingInput({ expected_version: 3, status: "cancelled", assigned_to: null, preferred_time: null }, false)).toEqual({ expected_version: 3, status: "cancelled", assigned_to: null, preferred_time: null }));
  for (const query of ["page=0", "limit=101", "page=1&page=2", "unknown=1", "status=in_progress", "customer_id=11111111-1111-4111-8111-111111111111", "assigned_to=11111111-1111-4111-8111-111111111111", "property_id=invalid"]) {
    it("rejects invalid or foreign customer filter " + query, () => expect(() => parseViewingQuery(new URLSearchParams(query), false)).toThrow());
  }
  it("bounds staff filters and event pagination separately", () => {
    expect(parseViewingQuery(new URLSearchParams(), true)).toEqual({ page: 1, limit: 25 });
    expect(() => parseViewingQuery(new URLSearchParams("status=new"), true, false, true)).toThrow();
    expect(() => parseViewingQuery(new URLSearchParams("property_id=11111111-1111-4111-8111-111111111111"), true, true)).toThrow();
    expect(viewingDeleteQuery(new URLSearchParams("expected_version=2"))).toBe(2);
    expect(() => viewingDeleteQuery(new URLSearchParams("expected_version=2&expected_version=2"))).toThrow();
  });
  it("caps streamed JSON without trusting content length", async () => {
    await expect(viewingJson(new Request("http://localhost", { method: "POST", body: '"' + "x".repeat(16384) + '"' }))).rejects.toMatchObject({ status: 413 });
    await expect(viewingJson(new Request("http://localhost", { method: "POST", body: "{" }))).rejects.toMatchObject({ status: 400 });
    expect(await viewingJson(new Request("http://localhost", { method: "POST" }), true)).toEqual({});
  });
});
