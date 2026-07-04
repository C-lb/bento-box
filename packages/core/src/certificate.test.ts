import { describe, it, expect } from "vitest";
import { certificateSpec, CERTIFICATE_LAYOUTS } from "./certificate.js";
import { deriveFields } from "./merge.js";

const base = {
  title: "Certificate of Completion",
  bodyLine: "This certifies that",
  recipientField: "Name",
  detailLine: "has completed the workshop",
  dateText: "4 July 2026",
  signatureName: "SPARK",
} as const;

describe("certificateSpec", () => {
  it("is A4 landscape", () => {
    const s = certificateSpec({ ...base, layout: "classic" });
    expect(s.page.width).toBeCloseTo(841.89, 1);
    expect(s.page.height).toBeCloseTo(595.28, 1);
  });
  it("exposes the recipient as a mergeable {field} token", () => {
    const s = certificateSpec({ ...base, layout: "classic" });
    expect(deriveFields(s)).toContain("Name");
  });
  it("honours a custom recipient field name", () => {
    const s = certificateSpec({ ...base, recipientField: "Attendee", layout: "modern" });
    expect(deriveFields(s)).toContain("Attendee");
  });
  it("centers the recipient headline", () => {
    const s = certificateSpec({ ...base, layout: "classic" });
    const headline = s.elements.find(
      (e) => e.kind === "text" && e.template.includes("{Name}"),
    );
    expect(headline).toBeTruthy();
    expect(headline && headline.kind === "text" && headline.align).toBe("center");
  });
  it("minimal layout omits the signature line", () => {
    const min = certificateSpec({ ...base, layout: "minimal" });
    const hasSig = min.elements.some((e) => e.kind === "text" && e.template.includes("SPARK"));
    expect(hasSig).toBe(false);
  });
  it("classic layout includes the signature line", () => {
    const c = certificateSpec({ ...base, layout: "classic" });
    const hasSig = c.elements.some((e) => e.kind === "text" && e.template.includes("SPARK"));
    expect(hasSig).toBe(true);
  });
  it("lists three layouts", () => {
    expect(CERTIFICATE_LAYOUTS.map((l) => l.id)).toEqual(["classic", "modern", "minimal"]);
  });
});
