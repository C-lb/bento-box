import { describe, it, expect } from "vitest";
import {
  customDesignToSpec, textBaselineY, pageSizeFromImage, newElementId,
  type CustomDesign,
} from "./custom-design.js";

const page = { width: 400, height: 300 };

function design(partial: Partial<CustomDesign>): CustomDesign {
  return { v: 1, page, background: null, elements: [], ...partial };
}

describe("textBaselineY", () => {
  it("flips top-left y to a bottom-left baseline below the box top", () => {
    // box top at y=50, size 20 → baseline = 300 - 50 - 20*0.75 = 235
    expect(textBaselineY(300, { y: 50, size: 20 })).toBeCloseTo(235);
  });
});

describe("pageSizeFromImage", () => {
  it("assumes 300 DPI (px * 72 / 300)", () => {
    expect(pageSizeFromImage(1500, 900)).toEqual({ width: 360, height: 216 });
  });
});

describe("customDesignToSpec", () => {
  it("compiles a field element to a text element with a {token} template", () => {
    const spec = customDesignToSpec(design({
      elements: [{ id: "a", type: "field", field: "Name", x: 10, y: 50, w: 200, h: 30, size: 20, color: "#112233", align: "left" }],
    }), {});
    expect(spec.page).toEqual(page);
    expect(spec.elements).toEqual([
      { kind: "text", template: "{Name}", x: 10, y: textBaselineY(300, { y: 50, size: 20 }), size: 20, font: "body", align: "left", color: "#112233", fontId: undefined },
    ]);
  });

  it("anchors center/right alignment to the box center/right edge", () => {
    const base = { id: "a", type: "text" as const, text: "hi", y: 0, w: 100, h: 20, size: 10, color: "#000000" };
    const spec = customDesignToSpec(design({
      elements: [
        { ...base, x: 10, align: "center" },
        { ...base, x: 10, align: "right" },
      ],
    }), {});
    expect(spec.elements[0]).toMatchObject({ x: 60 });  // 10 + 100/2
    expect(spec.elements[1]).toMatchObject({ x: 110 }); // 10 + 100
  });

  it("compiles image elements with a bottom-left y and resolves the asset src", () => {
    const spec = customDesignToSpec(design({
      elements: [{ id: "a", type: "image", assetId: "logo", x: 10, y: 20, w: 60, h: 40 }],
    }), { logo: "data:image/png;base64,AAAA" });
    expect(spec.elements).toEqual([
      { kind: "image", src: "data:image/png;base64,AAAA", x: 10, y: 300 - 20 - 40, width: 60, height: 40 },
    ]);
  });

  it("drops image elements whose asset is missing", () => {
    const spec = customDesignToSpec(design({
      elements: [{ id: "a", type: "image", assetId: "gone", x: 0, y: 0, w: 10, h: 10 }],
    }), {});
    expect(spec.elements).toEqual([]);
  });

  it("resolves the background asset, and omits background when its asset is missing", () => {
    const withBg = design({ background: { assetId: "bg", kind: "pdf" } });
    expect(customDesignToSpec(withBg, { bg: "QkFTRTY0" }).background).toEqual({ kind: "pdf", src: "QkFTRTY0" });
    expect(customDesignToSpec(withBg, {}).background).toBeUndefined();
  });
});

describe("newElementId", () => {
  it("returns unique non-empty ids", () => {
    const a = newElementId();
    expect(a).toBeTruthy();
    expect(newElementId()).not.toEqual(a);
  });
});
