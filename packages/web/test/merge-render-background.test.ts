import { describe, it, expect } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { renderOne, renderCombined, renderSheet } from "../lib/merge-render";
import type { DocumentSpec } from "@event-editor/core/merge";

// 1x1 red PNG
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function onePagePdfBase64(): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  page.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color: rgb(0.9, 0.2, 0.2) });
  return doc.saveAsBase64();
}

function spec(background: DocumentSpec["background"]): DocumentSpec {
  return {
    page: { width: 200, height: 100 },
    background,
    elements: [{ kind: "text", template: "{Name}", x: 10, y: 50, size: 12, font: "body", align: "left", color: "#000000" }],
  };
}

describe("background rendering", () => {
  it("renderOne with a png background produces a loadable 1-page pdf", async () => {
    const bytes = await renderOne(spec({ kind: "png", src: PNG_DATA_URL }), { Name: "Ada" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("renderOne with a pdf background embeds the page", async () => {
    const bytes = await renderOne(spec({ kind: "pdf", src: await onePagePdfBase64() }), { Name: "Ada" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // pdf background must render LARGER than the no-background version
    const plain = await renderOne(spec(undefined), { Name: "Ada" });
    expect(bytes.length).toBeGreaterThan(plain.length);
  });

  it("renderCombined draws the background on every page", async () => {
    const bytes = await renderCombined(spec({ kind: "png", src: PNG_DATA_URL }), [{ Name: "A" }, { Name: "B" }]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("renderSheet tiles cells with backgrounds without throwing", async () => {
    const bytes = await renderSheet(spec({ kind: "png", src: PNG_DATA_URL }), [{ Name: "A" }, { Name: "B" }]);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
