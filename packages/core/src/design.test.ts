import { describe, it, expect } from "vitest";
import {
  applyDesign,
  withBackground,
  sanitizeDesignOverrides,
  MM_TO_PT,
  LINE_TIE_TOLERANCE_PT,
  LINE_GAP_MIN,
  LINE_GAP_MAX,
  type DesignOverrides,
} from "./design.js";
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

describe("applyDesign — line spacing (lineGap)", () => {
  // Three stacked lines, top->bottom (PDF y-up: larger y = higher on page).
  const stacked: DocumentSpec = {
    page: { width: 200, height: 100 },
    elements: [
      { kind: "text", template: "Top", x: 100, y: 80, size: 12, font: "heading", align: "center", color: "#111111", slot: "title" },
      { kind: "text", template: "Mid", x: 100, y: 50, size: 12, font: "body", align: "center", color: "#111111", slot: "body" },
      { kind: "text", template: "Bottom", x: 100, y: 20, size: 12, font: "body", align: "center", color: "#111111", slot: "date" },
    ],
  };

  function ys(spec: DocumentSpec): number[] {
    return spec.elements.filter((e) => e.kind === "text").map((e) => (e.kind === "text" ? e.y : NaN));
  }

  it("keeps the top line fixed and shifts each subsequent line down cumulatively (positive gap)", () => {
    const out = applyDesign(stacked, { v: 1, lineGap: 10 });
    // Down in PDF y-up = y decreases: 80, 50-10, 20-20
    expect(ys(out)).toEqual([80, 40, 0]);
  });

  it("negative gap pulls subsequent lines up (tighter)", () => {
    const out = applyDesign(stacked, { v: 1, lineGap: -5 });
    expect(ys(out)).toEqual([80, 55, 30]);
  });

  it("lineGap 0 and undefined produce byte-identical output to no lineGap", () => {
    const base = applyDesign(stacked, { v: 1 });
    expect(JSON.stringify(applyDesign(stacked, { v: 1, lineGap: 0 }))).toBe(JSON.stringify(base));
    expect(JSON.stringify(applyDesign(stacked, { v: 1, lineGap: undefined }))).toBe(JSON.stringify(base));
  });

  it("derives line order from y, not array order, and preserves array order in the output", () => {
    const shuffled: DocumentSpec = {
      ...stacked,
      elements: [stacked.elements[2], stacked.elements[0], stacked.elements[1]],
    };
    const out = applyDesign(shuffled, { v: 1, lineGap: 10 });
    // Array order preserved (Bottom, Top, Mid) but shifts follow visual order.
    expect(ys(out)).toEqual([0, 80, 40]);
  });

  it("elements within the tie tolerance form one visual line: same shift, no extra gap", () => {
    const withTie: DocumentSpec = {
      ...stacked,
      elements: [
        ...stacked.elements,
        // Within LINE_TIE_TOLERANCE_PT of the y=50 line -> same visual line.
        { kind: "text", template: "MidTwin", x: 160, y: 50 - LINE_TIE_TOLERANCE_PT / 2, size: 12, font: "body", align: "left", color: "#111111", slot: "detail" },
      ],
    };
    const out = applyDesign(withTie, { v: 1, lineGap: 10 });
    // Lines: 80 (shift 0), {50, 49.5} (shift 10), 20 (shift 20 — tie adds no line).
    expect(ys(out)).toEqual([80, 40, 0, 50 - LINE_TIE_TOLERANCE_PT / 2 - 10]);
  });

  it("does not shift non-text elements", () => {
    const mixed: DocumentSpec = {
      ...stacked,
      elements: [...stacked.elements, { kind: "qr", value: "{Name}", x: 150, y: 10, size: 30 }],
    };
    const out = applyDesign(mixed, { v: 1, lineGap: 10 });
    const qr = out.elements.find((e) => e.kind === "qr");
    expect(qr && qr.kind === "qr" && qr.y).toBe(10);
  });

  it("composes with pageSize: gap applies in final page coordinates after scaling", () => {
    // sy = 300/100 = 3 -> scaled ys 240/150/60, then gap 10 per line on top.
    const out = applyDesign(stacked, { v: 1, pageSize: { width: 400, height: 300 }, lineGap: 10 });
    expect(ys(out)).toEqual([240, 140, 40]);
  });

  it("shifts text before border/divider appending: injected rects and lines are unaffected", () => {
    const out = applyDesign(stacked, {
      v: 1,
      lineGap: 10,
      border: { style: "single", color: "#000000", width: 1, inset: 10 },
      dividers: [{ y: 0.5, widthFrac: 0.5, color: "#000000", thickness: 1 }],
    });
    const rect = out.elements.find((e) => e.kind === "rect");
    const line = out.elements.find((e) => e.kind === "line");
    expect(rect && rect.kind === "rect" && rect.y).toBe(10);
    expect(line && line.kind === "line" && line.y1).toBe(50);
  });
});

describe("withBackground", () => {
  const bg = { kind: "pdf" as const, src: "data:application/pdf;base64,AAAA" };

  it("returns a copy with the background set, without mutating the input", () => {
    const out = withBackground(baseSpec, bg);
    expect(out.background).toEqual(bg);
    expect(out).not.toBe(baseSpec);
    expect(baseSpec.background).toBeUndefined();
  });

  it("returns the spec unchanged for null", () => {
    const out = withBackground(baseSpec, null);
    expect(out).toBe(baseSpec);
    expect(out.background).toBeUndefined();
  });

  it("returns the spec unchanged for undefined", () => {
    const out = withBackground(baseSpec, undefined);
    expect(out).toBe(baseSpec);
  });

  it("does not clear an existing background when passed null", () => {
    const specWithBg: DocumentSpec = { ...baseSpec, background: bg };
    expect(withBackground(specWithBg, null).background).toEqual(bg);
  });
});

describe("applyDesign — background id is inert (purity)", () => {
  it("carries the spec background through and ignores overrides.background", () => {
    const out = applyDesign(baseSpec, { v: 1, background: { id: "classic-navy" } });
    expect(out.background).toBeUndefined();
    const bg = { kind: "png" as const, src: "data:image/png;base64,AAAA" };
    const out2 = applyDesign({ ...baseSpec, background: bg }, { v: 1, background: null });
    expect(out2.background).toEqual(bg);
  });
});

describe("sanitizeDesignOverrides", () => {
  it("rejects non-objects and wrong versions", () => {
    expect(sanitizeDesignOverrides(undefined)).toBeUndefined();
    expect(sanitizeDesignOverrides(null)).toBeUndefined();
    expect(sanitizeDesignOverrides("x")).toBeUndefined();
    expect(sanitizeDesignOverrides(42)).toBeUndefined();
    expect(sanitizeDesignOverrides({})).toBeUndefined();
    expect(sanitizeDesignOverrides({ v: 2 })).toBeUndefined();
  });

  it("passes a fully valid overrides object through intact", () => {
    const o: DesignOverrides = {
      v: 1,
      pageSize: { width: 400, height: 300 },
      border: { style: "double", color: "#aabbcc", width: 2, inset: 24 },
      dividers: [{ y: 0.5, widthFrac: 0.8, color: "#112233", thickness: 1 }],
      text: { recipient: { fontId: "playfair", size: 30, letterSpacing: 1.5, color: "#00ff00", stroke: { color: "#000000", width: 1 } } },
      lineGap: 12,
      background: { id: "classic-navy" },
    };
    expect(sanitizeDesignOverrides(o)).toEqual(o);
  });

  it("clamps lineGap to [LINE_GAP_MIN, LINE_GAP_MAX] and drops 0/non-numeric", () => {
    expect(sanitizeDesignOverrides({ v: 1, lineGap: 999 })?.lineGap).toBe(LINE_GAP_MAX);
    expect(sanitizeDesignOverrides({ v: 1, lineGap: -999 })?.lineGap).toBe(LINE_GAP_MIN);
    expect(sanitizeDesignOverrides({ v: 1, lineGap: 0 })?.lineGap).toBeUndefined();
    expect(sanitizeDesignOverrides({ v: 1, lineGap: "big" })?.lineGap).toBeUndefined();
    expect(sanitizeDesignOverrides({ v: 1, lineGap: NaN })?.lineGap).toBeUndefined();
  });

  it("clamps pageSize to sane pt bounds and drops half-formed sizes", () => {
    const minPt = 20 * MM_TO_PT;
    const maxPt = 2000 * MM_TO_PT;
    const tiny = sanitizeDesignOverrides({ v: 1, pageSize: { width: 1, height: 1 } });
    expect(tiny?.pageSize).toEqual({ width: minPt, height: minPt });
    const huge = sanitizeDesignOverrides({ v: 1, pageSize: { width: 1e9, height: 1e9 } });
    expect(huge?.pageSize).toEqual({ width: maxPt, height: maxPt });
    expect(sanitizeDesignOverrides({ v: 1, pageSize: { width: 400 } })?.pageSize).toBeUndefined();
    expect(sanitizeDesignOverrides({ v: 1, pageSize: { width: 400, height: "x" } })?.pageSize).toBeUndefined();
  });

  it("clamps border width/inset and drops borders with bad style or colour", () => {
    const o = sanitizeDesignOverrides({ v: 1, border: { style: "single", color: "#123456", width: 100, inset: -5 } });
    expect(o?.border).toEqual({ style: "single", color: "#123456", width: 20, inset: 0 });
    expect(sanitizeDesignOverrides({ v: 1, border: { style: "wavy", color: "#123456", width: 1, inset: 0 } })?.border).toBeUndefined();
    expect(sanitizeDesignOverrides({ v: 1, border: { style: "single", color: "red", width: 1, inset: 0 } })?.border).toBeUndefined();
  });

  it("clamps divider fields and drops malformed entries", () => {
    const o = sanitizeDesignOverrides({
      v: 1,
      dividers: [
        { y: 5, widthFrac: 0, color: "#000000", thickness: 100 },
        { y: 0.5, widthFrac: 0.5, color: "javascript:alert(1)", thickness: 1 },
        "junk",
      ],
    });
    expect(o?.dividers).toEqual([{ y: 1, widthFrac: 0.01, color: "#000000", thickness: 20 }]);
  });

  it("clamps text size/tracking/stroke width, keeps stroke:null, drops bad colours and empty styles", () => {
    const o = sanitizeDesignOverrides({
      v: 1,
      text: {
        a: { size: 1000, letterSpacing: -100, color: "#abcdef", stroke: { color: "#000000", width: 50 } },
        b: { stroke: null },
        c: { color: "not-a-colour" },
        d: "junk",
      },
    });
    expect(o?.text?.a).toEqual({ size: 300, letterSpacing: -20, color: "#abcdef", stroke: { color: "#000000", width: 20 } });
    expect(o?.text?.b).toEqual({ stroke: null });
    expect(o?.text?.c).toBeUndefined();
    expect(o?.text?.d).toBeUndefined();
  });

  it("keeps background {id} and explicit null, drops junk ids", () => {
    expect(sanitizeDesignOverrides({ v: 1, background: { id: "classic-navy" } })?.background).toEqual({ id: "classic-navy" });
    expect(sanitizeDesignOverrides({ v: 1, background: null })?.background).toBeNull();
    expect(sanitizeDesignOverrides({ v: 1, background: { id: "" } })?.background).toBeUndefined();
    expect(sanitizeDesignOverrides({ v: 1, background: { id: 7 } })?.background).toBeUndefined();
    expect(sanitizeDesignOverrides({ v: 1, background: "x" })?.background).toBeUndefined();
  });

  it("always yields a v:1 object for valid input, even when every field is dropped", () => {
    expect(sanitizeDesignOverrides({ v: 1, pageSize: "junk", text: [] })).toEqual({ v: 1 });
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
