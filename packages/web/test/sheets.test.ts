import { describe, it, expect, vi } from "vitest";
import { extractSpreadsheetId, listTabs, readValues } from "../lib/google/sheets";

describe("extractSpreadsheetId", () => {
  it("pulls the id from a docs url", () => {
    expect(extractSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbC_def-123/edit#gid=0")).toBe("1AbC_def-123");
  });
  it("returns a bare id unchanged", () => {
    expect(extractSpreadsheetId("1AbC_def-123")).toBe("1AbC_def-123");
  });
});

describe("listTabs / readValues", () => {
  it("lists tab titles", async () => {
    const sheets = { spreadsheets: { get: vi.fn(async () => ({ data: { sheets: [{ properties: { title: "Roster" } }, { properties: { title: "Sheet2" } }] } })) } } as any;
    expect(await listTabs(sheets, "id1")).toEqual(["Roster", "Sheet2"]);
  });
  it("splits header from rows", async () => {
    const sheets = { spreadsheets: { values: { get: vi.fn(async () => ({ data: { values: [["Name", "Title"], ["Ada", "CTO"], ["Linus", "Eng"]] } })) } } } as any;
    expect(await readValues(sheets, "id1", "Roster")).toEqual({ header: ["Name", "Title"], rows: [["Ada", "CTO"], ["Linus", "Eng"]] });
  });
  it("handles an empty sheet", async () => {
    const sheets = { spreadsheets: { values: { get: vi.fn(async () => ({ data: {} })) } } } as any;
    expect(await readValues(sheets, "id1", "Roster")).toEqual({ header: [], rows: [] });
  });
});
