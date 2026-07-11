import { describe, it, expect } from "vitest";
import { customDesignToSpec, type CustomDesign } from "@event-editor/core/custom-design";
import { deriveFields, autoMatchColumns, remapRows } from "@event-editor/core/merge";

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

describe("Custom mode respects the user's typed recipient-column input when merging rows", () => {
  // Reproduces the reported bug: a sheet column named "Participant" (which
  // autoMatchColumns can't resolve via exact/synonym header match against the
  // fixed "Name" token) is only wired up because the user typed "Participant"
  // into the recipient-column input. remapRows must honour that explicit
  // choice for the recipient's fixed token, not just what auto-matching found.
  const design: CustomDesign = {
    v: 1,
    page: { width: 400, height: 300 },
    background: null,
    elements: [
      { id: "1", type: "field", field: "Name", x: 10, y: 10, w: 100, h: 20, size: 14, color: "#000000", align: "left" },
    ],
  };

  it("remaps the fixed recipient token from the user's chosen column, not just auto-match", () => {
    const spec = customDesignToSpec(design, {});
    const fields = deriveFields(spec);
    const headers = ["Participant"];
    const mapping = autoMatchColumns(fields, headers);
    // Auto-match can't resolve "Name" -> "Participant" (no exact/synonym hit).
    expect(mapping["Name"]).toBeNull();

    const recipientField = "Participant"; // what the user typed into the recipient input
    const recipientColumn = mapping[recipientField] ?? recipientField;
    const rows = [{ Participant: "Ada Lovelace" }];

    const merged = remapRows(rows, fields, mapping, "Name", recipientColumn);
    expect(merged[0]["Name"]).toBe("Ada Lovelace");
  });
});
