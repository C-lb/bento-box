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

describe("certificate's Custom mode field vocabulary flows through", () => {
  const certificateDesign: CustomDesign = {
    v: 1,
    page: { width: 841.89, height: 595.28 },
    background: null,
    elements: [
      { id: "1", type: "field", field: "Name", x: 40, y: 40, w: 200, h: 32, size: 24, color: "#111111", align: "center" },
      { id: "2", type: "field", field: "title", x: 40, y: 90, w: 200, h: 32, size: 18, color: "#111111", align: "center" },
      { id: "3", type: "text", text: "Static caption", x: 40, y: 140, w: 200, h: 20, size: 12, color: "#111111", align: "left" },
    ],
  };

  it("recipient and copy-field elements surface as mappable fields on the certificate", () => {
    const spec = customDesignToSpec(certificateDesign, {});
    const fields = deriveFields(spec);
    expect(fields).toContain("Name");
    expect(fields).toContain("title");
    expect(fields).not.toContain("Static caption");
  });

  it("auto-matching binds the certificate's recipient field to a sheet column", () => {
    const spec = customDesignToSpec(certificateDesign, {});
    const mapping = autoMatchColumns(deriveFields(spec), ["Full Name", "title", "Email"]);
    expect(mapping["Name"]).toBe("Full Name");
  });
});
