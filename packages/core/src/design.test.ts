import { describe, it, expect } from "vitest";
import { applyDesign, MM_TO_PT, type DesignOverrides } from "./design.js";
import type { DocumentSpec } from "./merge.js";
import { certificateSpec, CERTIFICATE_LAYOUTS } from "./certificate.js";
import { badgeSpec, BADGE_LAYOUTS } from "./badge.js";
import { placecardSpec, PLACECARD_LAYOUTS } from "./placecard.js";
import { ticketSpec, TICKET_LAYOUTS } from "./ticket.js";

function slotsOf(spec: DocumentSpec): string[] {
  return spec.elements
    .filter((e): e is Extract<typeof e, { kind: "text" }> => e.kind === "text")
    .map((e) => e.slot)
    .filter((s): s is string => !!s);
}

const baseSpec: DocumentSpec = {
  page: { width: 200, height: 100 },
  elements: [
    { kind: "text", template: "{Name}", x: 100, y: 50, size: 20, font: "heading", align: "center", color: "#111111", slot: "recipient" },
    { kind: "image", src: "logo.png", x: 10, y: 10, width: 40, height: 20 },
    { kind: "qr", value: "{Name}", x: 150, y: 10, size: 30 },
  ],
};

describe("MM_TO_PT", () => {
  it("is the mm-to-pt conversion constant", () => {
    expect(MM_TO_PT).toBeCloseTo(2.83465, 5);
  });
});

describe("applyDesign — identity", () => {
  it("returns an equivalent spec when overrides is undefined", () => {
    const out = applyDesign(baseSpec);
    expect(out).toEqual(baseSpec);
  });

  it("returns an equivalent spec when overrides has no fields set", () => {
    const out = applyDesign(baseSpec, { v: 1 });
    expect(out).toEqual(baseSpec);
  });

  it("never mutates the input spec", () => {
    const clone = JSON.parse(JSON.stringify(baseSpec));
    applyDesign(baseSpec, {
      v: 1,
      pageSize: { width: 400, height: 300 },
      text: { recipient: { color: "#ff0000" } },
      border: { style: "single", color: "#000000", width: 2, inset: 10 },
      dividers: [{ y: 0.5, widthFrac: 0.8, color: "#000000", thickness: 1 }],
    });
    expect(baseSpec).toEqual(clone);
  });
});

describe("applyDesign — resizing", () => {
  it("scales element positions per-axis to the new page size", () => {
    const out = applyDesign(baseSpec, { v: 1, pageSize: { width: 400, height: 300 } });
    // sx = 400/200 = 2, sy = 300/100 = 3
    const recipient = out.elements.find((e) => e.kind === "text");
    expect(recipient && recipient.kind === "text" && recipient.x).toBeCloseTo(200, 5);
    expect(recipient && recipient.kind === "text" && recipient.y).toBeCloseTo(150, 5);
  });

  it("scales text size by the smaller of the two axis factors", () => {
    const out = applyDesign(baseSpec, { v: 1, pageSize: { width: 400, height: 300 } });
    // sx=2, sy=3, min=2 -> size 20*2=40
    const recipient = out.elements.find((e) => e.kind === "text");
    expect(recipient && recipient.kind === "text" && recipient.size).toBeCloseTo(40, 5);
  });

  it("scales image width by sx and height by sy", () => {
    const out = applyDesign(baseSpec, { v: 1, pageSize: { width: 400, height: 300 } });
    const img = out.elements.find((e) => e.kind === "image");
    expect(img && img.kind === "image" && img.width).toBeCloseTo(80, 5);
    expect(img && img.kind === "image" && img.height).toBeCloseTo(60, 5);
    expect(img && img.kind === "image" && img.x).toBeCloseTo(20, 5);
    expect(img && img.kind === "image" && img.y).toBeCloseTo(30, 5);
  });

  it("scales qr square size by the smaller axis factor", () => {
    const out = applyDesign(baseSpec, { v: 1, pageSize: { width: 400, height: 300 } });
    const qr = out.elements.find((e) => e.kind === "qr");
    expect(qr && qr.kind === "qr" && qr.size).toBeCloseTo(60, 5);
  });

  it("applies an explicit per-slot size override as an absolute value after scaling", () => {
    const out = applyDesign(baseSpec, {
      v: 1,
      pageSize: { width: 400, height: 300 },
      text: { recipient: { size: 99 } },
    });
    const recipient = out.elements.find((e) => e.kind === "text");
    expect(recipient && recipient.kind === "text" && recipient.size).toBe(99);
  });

  it("leaves positions/sizes unchanged when pageSize is not provided", () => {
    const out = applyDesign(baseSpec, { v: 1 });
    const recipient = out.elements.find((e) => e.kind === "text");
    expect(recipient && recipient.kind === "text" && recipient.size).toBe(20);
    expect(out.page).toEqual(baseSpec.page);
  });
});

describe("applyDesign — text style merge", () => {
  it("merges fontId, letterSpacing, color onto the matching slot", () => {
    const out = applyDesign(baseSpec, {
      v: 1,
      text: { recipient: { fontId: "playfair", letterSpacing: 1.5, color: "#00ff00" } },
    });
    const el = out.elements.find((e) => e.kind === "text");
    expect(el && el.kind === "text" && el.fontId).toBe("playfair");
    expect(el && el.kind === "text" && el.letterSpacing).toBe(1.5);
    expect(el && el.kind === "text" && el.color).toBe("#00ff00");
  });

  it("sets a stroke when provided", () => {
    const out = applyDesign(baseSpec, {
      v: 1,
      text: { recipient: { stroke: { color: "#000000", width: 1 } } },
    });
    const el = out.elements.find((e) => e.kind === "text");
    expect(el && el.kind === "text" && el.stroke).toEqual({ color: "#000000", width: 1 });
  });

  it("removes an existing stroke when stroke is explicitly null", () => {
    const withStroke: DocumentSpec = {
      ...baseSpec,
      elements: baseSpec.elements.map((e) =>
        e.kind === "text" ? { ...e, stroke: { color: "#000000", width: 2 } } : e,
      ),
    };
    const out = applyDesign(withStroke, { v: 1, text: { recipient: { stroke: null } } });
    const el = out.elements.find((e) => e.kind === "text");
    expect(el && el.kind === "text" && "stroke" in el ? el.stroke : undefined).toBeUndefined();
  });

  it("leaves stroke untouched when stroke is undefined in the override", () => {
    const withStroke: DocumentSpec = {
      ...baseSpec,
      elements: baseSpec.elements.map((e) =>
        e.kind === "text" ? { ...e, stroke: { color: "#000000", width: 2 } } : e,
      ),
    };
    const out = applyDesign(withStroke, { v: 1, text: { recipient: { color: "#123456" } } });
    const el = out.elements.find((e) => e.kind === "text");
    expect(el && el.kind === "text" && el.stroke).toEqual({ color: "#000000", width: 2 });
  });

  it("does not apply a style to elements with a different or missing slot", () => {
    const out = applyDesign(baseSpec, {
      v: 1,
      text: { someOtherSlot: { color: "#ff00ff" } },
    });
    const el = out.elements.find((e) => e.kind === "text");
    expect(el && el.kind === "text" && el.color).toBe("#111111");
  });
});

describe("applyDesign — border", () => {
  it("style none injects no rect", () => {
    const out = applyDesign(baseSpec, { v: 1, border: { style: "none", color: "#000", width: 1, inset: 5 } });
    expect(out.elements.some((e) => e.kind === "rect")).toBe(false);
  });

  it("style single injects one inset rect touching every page edge", () => {
    const out = applyDesign(baseSpec, { v: 1, border: { style: "single", color: "#333333", width: 2, inset: 10 } });
    const rects = out.elements.filter((e) => e.kind === "rect");
    expect(rects).toHaveLength(1);
    const r = rects[0];
    expect(r.kind === "rect" && r.x).toBe(10);
    expect(r.kind === "rect" && r.y).toBe(10);
    expect(r.kind === "rect" && r.width).toBe(baseSpec.page.width - 20);
    expect(r.kind === "rect" && r.height).toBe(baseSpec.page.height - 20);
    expect(r.kind === "rect" && r.strokeColor).toBe("#333333");
    expect(r.kind === "rect" && r.strokeWidth).toBe(2);
  });

  it("style double injects an outer rect at inset and an inner rect at inset + 3*width + 4", () => {
    const out = applyDesign(baseSpec, { v: 1, border: { style: "double", color: "#000000", width: 3, inset: 10 } });
    const rects = out.elements.filter((e) => e.kind === "rect");
    expect(rects).toHaveLength(2);
    const [outer, inner] = rects;
    expect(outer.kind === "rect" && outer.x).toBe(10);
    const innerInset = 10 + 3 * 3 + 4; // 23
    expect(inner.kind === "rect" && inner.x).toBe(innerInset);
    expect(inner.kind === "rect" && inner.y).toBe(innerInset);
    expect(inner.kind === "rect" && inner.width).toBe(baseSpec.page.width - 2 * innerInset);
    expect(inner.kind === "rect" && inner.height).toBe(baseSpec.page.height - 2 * innerInset);
  });

  it("border rects are appended after existing elements", () => {
    const out = applyDesign(baseSpec, { v: 1, border: { style: "single", color: "#000", width: 1, inset: 5 } });
    expect(out.elements[out.elements.length - 1].kind).toBe("rect");
  });

  it("border applies to the resized page when pageSize is also overridden", () => {
    const out = applyDesign(baseSpec, {
      v: 1,
      pageSize: { width: 400, height: 300 },
      border: { style: "single", color: "#000", width: 1, inset: 10 },
    });
    const r = out.elements.find((e) => e.kind === "rect");
    expect(r && r.kind === "rect" && r.width).toBe(400 - 20);
    expect(r && r.kind === "rect" && r.height).toBe(300 - 20);
  });
});

describe("applyDesign — dividers", () => {
  it("injects a centred horizontal line at y * pageHeight spanning widthFrac * pageWidth", () => {
    const out = applyDesign(baseSpec, {
      v: 1,
      dividers: [{ y: 0.5, widthFrac: 0.5, color: "#abcdef", thickness: 2 }],
    });
    const lines = out.elements.filter((e) => e.kind === "line");
    expect(lines).toHaveLength(1);
    const l = lines[0];
    // page 200x100, y=0.5*100=50, span=0.5*200=100, centered -> x1=50,x2=150
    expect(l.kind === "line" && l.y1).toBe(50);
    expect(l.kind === "line" && l.y2).toBe(50);
    expect(l.kind === "line" && l.x1).toBe(50);
    expect(l.kind === "line" && l.x2).toBe(150);
    expect(l.kind === "line" && l.color).toBe("#abcdef");
    expect(l.kind === "line" && l.thickness).toBe(2);
  });

  it("supports multiple dividers", () => {
    const out = applyDesign(baseSpec, {
      v: 1,
      dividers: [
        { y: 0.2, widthFrac: 0.5, color: "#000", thickness: 1 },
        { y: 0.8, widthFrac: 0.5, color: "#000", thickness: 1 },
      ],
    });
    expect(out.elements.filter((e) => e.kind === "line")).toHaveLength(2);
  });

  it("uses the resized page for divider geometry", () => {
    const out = applyDesign(baseSpec, {
      v: 1,
      pageSize: { width: 400, height: 300 },
      dividers: [{ y: 0.5, widthFrac: 1, color: "#000", thickness: 1 }],
    });
    const l = out.elements.find((e) => e.kind === "line");
    expect(l && l.kind === "line" && l.y1).toBe(150);
    expect(l && l.kind === "line" && l.x1).toBe(0);
    expect(l && l.kind === "line" && l.x2).toBe(400);
  });
});

describe("layout factories emit expected slot sets", () => {
  const certBase = {
    title: "Certificate of Completion",
    bodyLine: "This certifies that",
    recipientField: "Name",
    detailLine: "has completed the workshop",
    dateText: "4 July 2026",
    signatureName: "SPARK",
  } as const;

  it("certificate classic emits title/body/recipient/detail/date/signature", () => {
    const s = certificateSpec({ ...certBase, layout: "classic" });
    expect(slotsOf(s).sort()).toEqual(["body", "date", "detail", "recipient", "signature", "title"]);
  });

  it("certificate modern emits title/body/recipient/date/signature (body+detail share one line)", () => {
    const s = certificateSpec({ ...certBase, layout: "modern" });
    expect(slotsOf(s).sort()).toEqual(["body", "date", "recipient", "signature", "title"]);
  });

  it("certificate minimal omits signature but keeps the rest", () => {
    const s = certificateSpec({ ...certBase, layout: "minimal" });
    expect(slotsOf(s).sort()).toEqual(["date", "detail", "recipient", "title"]);
  });

  it("certificate slot ids are stable across all layouts", () => {
    expect(CERTIFICATE_LAYOUTS.length).toBe(3);
  });

  const badgeBase = { nameField: "Name", orgField: "Org", eventTitle: "SPARK Summit" } as const;

  it("badge centered/leftQr emit event/name/org", () => {
    for (const layout of BADGE_LAYOUTS.map((l) => l.id)) {
      const s = badgeSpec({ ...badgeBase, layout, qr: false });
      expect(slotsOf(s).sort()).toEqual(["event", "name", "org"]);
    }
  });

  it("placecard classic emits name only; withTable adds table", () => {
    const classic = placecardSpec({ layout: "classic", nameField: "Name", tableField: "Table" });
    expect(slotsOf(classic)).toEqual(["name"]);
    const withTable = placecardSpec({ layout: "withTable", nameField: "Name", tableField: "Table" });
    expect(slotsOf(withTable).sort()).toEqual(["name", "table"]);
  });

  it("placecard slot ids are stable across layouts", () => {
    expect(PLACECARD_LAYOUTS.length).toBe(2);
  });

  const ticketBase = { eventTitle: "SPARK Summit", nameField: "Name", codeField: "Code" } as const;

  it("ticket classic emits event/name/detail", () => {
    const s = ticketSpec({ ...ticketBase, layout: "classic", qr: false });
    expect(slotsOf(s).sort()).toEqual(["detail", "event", "name"]);
  });

  it("ticket minimal emits event/name (no separate detail line)", () => {
    const s = ticketSpec({ ...ticketBase, layout: "minimal", qr: false });
    expect(slotsOf(s).sort()).toEqual(["event", "name"]);
  });
});
