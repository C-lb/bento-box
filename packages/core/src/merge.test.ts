import { describe, it, expect } from "vitest";
import { resolveText } from "./merge.js";

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
