import { describe, it, expect } from "vitest";
import { resolveText, parseDelimited, deriveFields, autoMatchColumns } from "./merge.js";
import type { DocumentSpec } from "./merge.js";

describe("resolveText", () => {
  it("substitutes a token with the matching column value", () => {
    expect(resolveText("Awarded to {Name}", { Name: "Ada Lovelace" }))
      .toBe("Awarded to Ada Lovelace");
  });
  it("matches column names case-insensitively", () => {
    expect(resolveText("{name}", { Name: "Ada" })).toBe("Ada");
  });
  it("replaces an unknown token with an empty string", () => {
    expect(resolveText("Hi {Missing}!", { Name: "Ada" })).toBe("Hi !");
  });
  it("leaves text with no tokens untouched", () => {
    expect(resolveText("Certificate of Completion", {})).toBe("Certificate of Completion");
  });
  it("substitutes multiple tokens", () => {
    expect(resolveText("{Name} — {Org}", { Name: "Ada", Org: "Analytical" }))
      .toBe("Ada — Analytical");
  });
});

describe("parseDelimited", () => {
  it("treats every line of a single column as a Name row (no header)", () => {
    const out = parseDelimited("Ada\nGrace");
    expect(out.headers).toEqual(["Name"]);
    expect(out.rows).toEqual([{ Name: "Ada" }, { Name: "Grace" }]);
  });
  it("names a headerless single value column 'Name'", () => {
    const out = parseDelimited("Ada");
    expect(out.headers).toEqual(["Name"]);
    expect(out.rows).toEqual([{ Name: "Ada" }]);
  });
  it("parses tab-separated columns with the first row as header", () => {
    const out = parseDelimited("Name\tOrg\nAda\tAnalytical\nGrace\tNavy");
    expect(out.headers).toEqual(["Name", "Org"]);
    expect(out.rows).toEqual([
      { Name: "Ada", Org: "Analytical" },
      { Name: "Grace", Org: "Navy" },
    ]);
  });
  it("parses comma-separated columns", () => {
    const out = parseDelimited("Name,Org\nAda,Analytical");
    expect(out.rows).toEqual([{ Name: "Ada", Org: "Analytical" }]);
  });
  it("ignores blank lines and trims cells", () => {
    const out = parseDelimited(" Ada \n\nGrace\n");
    expect(out.rows).toEqual([{ Name: "Ada" }, { Name: "Grace" }]);
  });
});

const spec: DocumentSpec = {
  page: { width: 100, height: 100 },
  elements: [
    { kind: "text", template: "To {Name}", x: 0, y: 0, size: 12, font: "heading", align: "left", color: "#000000" },
    { kind: "text", template: "{Name} of {Org}", x: 0, y: 0, size: 12, font: "body", align: "left", color: "#000000" },
    { kind: "text", template: "Static line", x: 0, y: 0, size: 12, font: "body", align: "left", color: "#000000" },
  ],
};

describe("deriveFields", () => {
  it("returns distinct tokens in first-seen order", () => {
    expect(deriveFields(spec)).toEqual(["Name", "Org"]);
  });
  it("returns empty when there are no tokens", () => {
    expect(deriveFields({ page: { width: 1, height: 1 }, elements: [] })).toEqual([]);
  });
});

describe("autoMatchColumns", () => {
  it("matches on exact (case-insensitive) header name", () => {
    expect(autoMatchColumns(["Name", "Org"], ["name", "ORG"]))
      .toEqual({ Name: "name", Org: "ORG" });
  });
  it("matches via synonyms", () => {
    expect(autoMatchColumns(["Org"], ["Company"])).toEqual({ Org: "Company" });
  });
  it("returns null for an unmatched field", () => {
    expect(autoMatchColumns(["Name"], ["Email"])).toEqual({ Name: null });
  });
  it("never assigns one header to two fields", () => {
    const m = autoMatchColumns(["Name", "Recipient"], ["Name"]);
    const used = Object.values(m).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });
});
