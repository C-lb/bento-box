import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { renderCombined, renderZip } from "./merge-render";
import type { DocumentSpec } from "@event-editor/core/merge";

const spec: DocumentSpec = {
  page: { width: 841.89, height: 595.28 },
  elements: [
    { kind: "text", template: "To {Name}", x: 420, y: 300, size: 40, font: "heading", align: "center", color: "#111111" },
  ],
};
const rows = [{ Name: "Ada" }, { Name: "Grace" }, { Name: "Katherine" }];

describe("renderCombined", () => {
  it("produces one page per row at the spec's page size", async () => {
    const bytes = await renderCombined(spec, rows);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    const p = doc.getPage(0);
    expect(p.getWidth()).toBeCloseTo(841.89, 0);
    expect(p.getHeight()).toBeCloseTo(595.28, 0);
  });
  it("returns a valid empty-safe PDF for zero rows", async () => {
    const bytes = await renderCombined(spec, []);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(0);
  });
});

describe("renderZip", () => {
  it("creates one named PDF per row", async () => {
    const blob = await renderZip(spec, rows, "Name");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(["Ada.pdf", "Grace.pdf", "Katherine.pdf"]);
  });
  it("disambiguates duplicate names", async () => {
    const dup = [{ Name: "Ada" }, { Name: "Ada" }];
    const blob = await renderZip(spec, dup, "Name");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["Ada-2.pdf", "Ada.pdf"]);
  });
});
