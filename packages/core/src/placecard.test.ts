import { describe, it, expect } from "vitest";
import { placecardSpec, PLACECARD_LAYOUTS } from "./placecard.js";
import { deriveFields } from "./merge.js";

describe("placecardSpec", () => {
  it("is a flat 4x2.5in card (288x180)", () => {
    const s = placecardSpec({ layout: "classic", nameField: "Name", tableField: "Table" });
    expect(s.page).toEqual({ width: 288, height: 180 });
  });
  it("classic exposes only the name field", () => {
    const s = placecardSpec({ layout: "classic", nameField: "Name", tableField: "Table" });
    expect(deriveFields(s)).toEqual(["Name"]);
  });
  it("withTable exposes name and table fields", () => {
    const s = placecardSpec({ layout: "withTable", nameField: "Name", tableField: "Table" });
    expect(deriveFields(s)).toEqual(["Name", "Table"]);
  });
  it("centers the name", () => {
    const s = placecardSpec({ layout: "classic", nameField: "Name", tableField: "Table" });
    const nameEl = s.elements.find((e) => e.kind === "text" && e.template.includes("{Name}"));
    expect(nameEl && nameEl.kind === "text" && nameEl.align).toBe("center");
  });
  it("lists two layouts", () => {
    expect(PLACECARD_LAYOUTS.map((l) => l.id)).toEqual(["classic", "withTable"]);
  });
});
