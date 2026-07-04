import { describe, it, expect } from "vitest";
import { rowsFromValues } from "./merge-sheet";

describe("rowsFromValues", () => {
  it("keys rows by header", () => {
    const out = rowsFromValues({ header: ["Name", "Org"], rows: [["Ada", "Analytical"], ["Grace", "Navy"]] });
    expect(out.headers).toEqual(["Name", "Org"]);
    expect(out.rows).toEqual([
      { Name: "Ada", Org: "Analytical" },
      { Name: "Grace", Org: "Navy" },
    ]);
  });
  it("pads missing trailing cells with empty strings", () => {
    const out = rowsFromValues({ header: ["Name", "Org"], rows: [["Ada"]] });
    expect(out.rows[0]).toEqual({ Name: "Ada", Org: "" });
  });
  it("drops fully-blank rows and trims cells", () => {
    const out = rowsFromValues({ header: ["Name"], rows: [[" Ada "], ["  "], ["Grace"]] });
    expect(out.rows).toEqual([{ Name: "Ada" }, { Name: "Grace" }]);
  });
  it("returns empty for no header", () => {
    expect(rowsFromValues({ header: [], rows: [] })).toEqual({ headers: [], rows: [] });
  });
});
