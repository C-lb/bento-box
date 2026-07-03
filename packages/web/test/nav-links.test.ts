import { describe, it, expect } from "vitest";
import { orderTools, parseNavOrder, TOOL_LINKS } from "@/components/nav-links";

const hrefs = (links: { href: string }[]) => links.map((l) => l.href);
const DEFAULT = ["/sorter", "/transcribe", "/studio", "/slice", "/convert"];

describe("orderTools", () => {
  it("returns default order for an empty list", () => {
    expect(hrefs(orderTools([]))).toEqual(DEFAULT);
  });
  it("reorders by the stored href list", () => {
    expect(hrefs(orderTools(["/slice", "/studio", "/transcribe", "/sorter"]))).toEqual([
      "/slice",
      "/studio",
      "/transcribe",
      "/sorter",
      "/convert",
    ]);
  });
  it("drops unknown hrefs", () => {
    expect(hrefs(orderTools(["/slice", "/nope", "/sorter"]))).toEqual([
      "/slice",
      "/sorter",
      "/transcribe",
      "/studio",
      "/convert",
    ]);
  });
  it("appends tools missing from storage in default order", () => {
    expect(hrefs(orderTools(["/slice"]))).toEqual([
      "/slice",
      "/sorter",
      "/transcribe",
      "/studio",
      "/convert",
    ]);
  });
  it("ignores duplicate hrefs", () => {
    expect(hrefs(orderTools(["/slice", "/slice", "/sorter"]))).toEqual([
      "/slice",
      "/sorter",
      "/transcribe",
      "/studio",
      "/convert",
    ]);
  });
});

describe("parseNavOrder", () => {
  it("returns default order for null", () => {
    expect(hrefs(parseNavOrder(null))).toEqual(DEFAULT);
  });
  it("returns default order for malformed JSON", () => {
    expect(hrefs(parseNavOrder("{not json"))).toEqual(DEFAULT);
  });
  it("returns default order when JSON is not an array", () => {
    expect(hrefs(parseNavOrder('{"a":1}'))).toEqual(DEFAULT);
  });
  it("reorders from a valid JSON array", () => {
    expect(hrefs(parseNavOrder('["/slice","/studio","/transcribe","/sorter"]'))).toEqual([
      "/slice",
      "/studio",
      "/transcribe",
      "/sorter",
      "/convert",
    ]);
  });
  it("keeps TOOL_LINKS default order stable", () => {
    expect(hrefs(TOOL_LINKS)).toEqual(DEFAULT);
  });
});
