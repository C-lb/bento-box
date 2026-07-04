import { describe, it, expect } from "vitest";
import { resolveText, parseDelimited } from "./merge.js";

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
  it("treats a single column of lines as Name rows (first line is header)", () => {
    const out = parseDelimited("Name\nAda\nGrace");
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
    const out = parseDelimited("Name\n Ada \n\nGrace\n");
    expect(out.rows).toEqual([{ Name: "Ada" }, { Name: "Grace" }]);
  });
});
