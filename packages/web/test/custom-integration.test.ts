import { describe, it, expect } from "vitest";
import { customDesignToSpec, type CustomDesign } from "@event-editor/core/custom-design";
import { deriveFields, autoMatchColumns } from "@event-editor/core/merge";

const design: CustomDesign = {
  v: 1,
  page: { width: 400, height: 300 },
  background: null,
  elements: [
    { id: "1", type: "field", field: "Name", x: 10, y: 10, w: 100, h: 20, size: 14, color: "#000000", align: "left" },
    { id: "2", type: "field", field: "Org", x: 10, y: 40, w: 100, h: 20, size: 12, color: "#000000", align: "left" },
    { id: "3", type: "text", text: "Certificate of participation", x: 10, y: 70, w: 200, h: 20, size: 12, color: "#000000", align: "left" },
  ],
};

describe("custom design feeds the existing merge pipeline", () => {
  it("field elements surface as mappable fields; static text does not", () => {
    const spec = customDesignToSpec(design, {});
    const fields = deriveFields(spec);
    expect(fields).toContain("Name");
    expect(fields).toContain("Org");
    expect(fields).not.toContain("Certificate of participation");
  });

  it("auto-matching binds custom fields to sheet columns", () => {
    const spec = customDesignToSpec(design, {});
    const mapping = autoMatchColumns(deriveFields(spec), ["Full Name", "Org", "Email"]);
    expect(mapping["Org"]).toBe("Org");
  });
});
