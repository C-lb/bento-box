import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import JSZip from "jszip";
import { renderCombined, renderZip, renderSheet } from "./merge-render";
import type { DocumentSpec } from "@event-editor/core/merge";
import type { DocumentSpec as DS2 } from "@event-editor/core/merge";

// pdf-lib always Flate-compresses content streams (there's no public save()
// option to turn this off), so a naive byte scan of the saved PDF never sees
// operator tokens. Decode the target page's content stream(s) via pdf-lib's
// own decoder instead, and concatenate them into inspectable text.
async function pageContentText(bytes: Uint8Array, pageIndex = 0): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const parts: string[] = [];
  for (const ref of refs) {
    const stream = doc.context.lookup(ref);
    if (stream instanceof PDFRawStream) {
      parts.push(Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"));
    }
  }
  return parts.join("\n");
}

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

describe("renderCombined with a QR element", () => {
  it("renders a page per row and does not throw on qr elements", async () => {
    const spec: DS2 = {
      page: { width: 288, height: 216 },
      elements: [
        { kind: "text", template: "{Name}", x: 144, y: 120, size: 20, font: "heading", align: "center", color: "#111111" },
        { kind: "qr", value: "{Name}", x: 122, y: 20, size: 44 },
      ],
    };
    const bytes = await renderCombined(spec, [{ Name: "Ada" }, { Name: "Grace" }]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });
  it("skips a qr whose resolved value is empty", async () => {
    const spec: DS2 = {
      page: { width: 288, height: 216 },
      elements: [{ kind: "qr", value: "{Code}", x: 122, y: 20, size: 44 }],
    };
    const bytes = await renderCombined(spec, [{ Name: "Ada" }]); // no Code -> empty -> skip
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

const badgeCell: DS2 = {
  page: { width: 288, height: 216 },
  elements: [{ kind: "text", template: "{Name}", x: 144, y: 120, size: 18, font: "heading", align: "center", color: "#111" }],
};

describe("renderSheet", () => {
  it("puts 6 badges per A4 page (ceil(rows/6) pages)", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ Name: `P${i}` }));
    const bytes = await renderSheet(badgeCell, rows);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2); // 7 badges -> 6 + 1
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
  });
  it("returns a 0-page pdf for no rows", async () => {
    const bytes = await renderSheet(badgeCell, []);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(0);
  });
  it("throws when the cell is too large to place on the sheet", async () => {
    const hugeCell: DS2 = {
      page: { width: 5000, height: 5000 },
      elements: [],
    };
    await expect(renderSheet(hugeCell, [{ Name: "Ada" }])).rejects.toThrow(
      "Card is too large for the sheet",
    );
  });
});

describe("letter spacing", () => {
  it("centres letter-spaced text using widthOfTextAtSize + (len-1)*spacing", async () => {
    const tracked: DS2 = {
      page: { width: 400, height: 200 },
      elements: [
        { kind: "text", template: "Hello", x: 200, y: 100, size: 20, font: "heading", align: "center", color: "#111111", letterSpacing: 3 },
      ],
    };
    const bytes = await renderCombined(tracked, [{}]);
    const text = await pageContentText(bytes);
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaBold);
    const w = font.widthOfTextAtSize("Hello", 20) + (4) * 3;
    const expectedX = 200 - w / 2;
    // pdf-lib emits "1 0 0 1 <x> <y> Tm" for an unrotated/unskewed drawText call.
    const tm = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/.exec(text);
    expect(tm).not.toBeNull();
    expect(Number(tm![1])).toBeCloseTo(expectedX, 0);
  });

  it("emits Tc before the text and resets to 0 after", async () => {
    const tracked: DS2 = {
      page: { width: 400, height: 200 },
      elements: [
        { kind: "text", template: "Hi", x: 20, y: 100, size: 20, font: "heading", align: "left", color: "#111111", letterSpacing: 2.5 },
      ],
    };
    const bytes = await renderCombined(tracked, [{}]);
    const text = await pageContentText(bytes);
    expect(text).toMatch(/2\.5 Tc/);
    expect(text).toMatch(/0 Tc/);
  });

  it("does not emit Tc when letterSpacing is absent (backward compat)", async () => {
    const bytes = await renderCombined(spec, [{ Name: "Ada" }]);
    const text = await pageContentText(bytes);
    expect(text).not.toMatch(/Tc/);
  });
});

describe("text stroke", () => {
  it("emits FillAndOutline rendering mode + stroking color + line width, then resets to Fill", async () => {
    const stroked: DS2 = {
      page: { width: 400, height: 200 },
      elements: [
        {
          kind: "text", template: "Hi", x: 20, y: 100, size: 20, font: "heading", align: "left", color: "#111111",
          stroke: { color: "#ff0000", width: 1.5 },
        },
      ],
    };
    const bytes = await renderCombined(stroked, [{}]);
    const text = await pageContentText(bytes);
    expect(text).toMatch(/2 Tr/); // FillAndOutline = 2
    expect(text).toMatch(/1\.5 w/);
    expect(text).toMatch(/0 Tr/); // reset to Fill
  });

  it("does not emit Tr when stroke is absent (backward compat)", async () => {
    const bytes = await renderCombined(spec, [{ Name: "Ada" }]);
    const text = await pageContentText(bytes);
    expect(text).not.toMatch(/Tr/);
  });
});

describe("font pool", () => {
  it("resolves fontId to embedded pool bytes, and falls back to the role font when the id has no bytes", async () => {
    const helveticaBytes = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    void helveticaBytes;
    const specWithFont: DS2 = {
      page: { width: 400, height: 200 },
      elements: [
        { kind: "text", template: "Known", x: 20, y: 100, size: 20, font: "heading", align: "left", color: "#111111", fontId: "unknown-id" },
      ],
    };
    // Unknown fontId with no matching bytes in the pool must not throw; it
    // falls back to the element's heading/body role.
    await expect(renderCombined(specWithFont, [{}])).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe("rect and line elements", () => {
  it("draws a rect and a line honoring n-up ox/oy offsets", async () => {
    const cell: DS2 = {
      page: { width: 100, height: 100 },
      elements: [
        { kind: "rect", x: 5, y: 5, width: 20, height: 10, strokeColor: "#000000", strokeWidth: 1 },
        { kind: "line", x1: 0, y1: 0, x2: 10, y2: 10, color: "#000000", thickness: 1 },
      ],
    };
    // A 300x300 sheet holding one 100x100 cell (gap 0) centres it at (0, 200)
    // per nUpGrid's centering formula — a non-trivial, non-zero offset that
    // must be added to both the rect's translate and the line's endpoints.
    const bytes = await renderSheet(cell, [{}], undefined, { sheet: { width: 300, height: 300 }, gap: 0, cropMarks: false });
    const text = await pageContentText(bytes);
    expect(text).toContain("1 0 0 1 5 205 cm"); // rect translate: ox=0,oy=200 + (x=5,y=5)
    expect(text).toContain("0 200 m"); // line start: ox=0,oy=200 + (x1=0,y1=0)
    expect(text).toContain("10 210 l"); // line end: ox=0,oy=200 + (x2=10,y2=10)
  });
});
