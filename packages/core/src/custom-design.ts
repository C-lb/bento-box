import type { DocumentSpec, Element, Align, PageSize } from "./merge.js";

interface Box { id: string; x: number; y: number; w: number; h: number }

export interface CustomTextStyle {
  /** Designer-registry or `upload:` font id; undefined = bundled body font.
   * Bold comes from picking a bold variant id (e.g. "dm-sans-bold"). */
  fontId?: string;
  size: number;
  color: string;
  align: Align;
}

export type CustomElement =
  | (Box & CustomTextStyle & { type: "field"; field: string })
  | (Box & CustomTextStyle & { type: "text"; text: string })
  | (Box & { type: "image"; assetId: string });

export interface CustomDesign {
  v: 1;
  /** PDF points. */
  page: PageSize;
  background: { assetId: string; kind: "png" | "jpg" | "pdf" } | null;
  /** Coordinates in PDF points, TOP-LEFT origin. The y-flip to pdf-lib's
   * bottom-left origin happens only here, in customDesignToSpec. */
  elements: CustomElement[];
}

/** Approximate ascent fraction used to place a text baseline inside the top
 * of its box, so rendered output lands where the editor overlay shows it. */
const ASCENT = 0.75;

export function textBaselineY(pageH: number, el: { y: number; size: number }): number {
  return pageH - el.y - el.size * ASCENT;
}

/** Image uploads assume 300 DPI: points = px * 72 / 300. */
export function pageSizeFromImage(pxW: number, pxH: number): PageSize {
  return { width: (pxW * 72) / 300, height: (pxH * 72) / 300 };
}

export function newElementId(): string {
  return crypto.randomUUID();
}

/**
 * Compiles a CustomDesign into the render pipeline's DocumentSpec.
 * `assets` maps assetId -> src (data URL for png/jpg, base64 for pdf).
 * Elements with missing assets are dropped (the UI shows a re-upload state).
 */
export function customDesignToSpec(design: CustomDesign, assets: Record<string, string>): DocumentSpec {
  const pageH = design.page.height;
  const elements: Element[] = [];
  for (const el of design.elements) {
    if (el.type === "image") {
      const src = assets[el.assetId];
      if (!src) continue;
      elements.push({ kind: "image", src, x: el.x, y: pageH - el.y - el.h, width: el.w, height: el.h });
    } else {
      const template = el.type === "field" ? `{${el.field}}` : el.text;
      const x = el.align === "center" ? el.x + el.w / 2 : el.align === "right" ? el.x + el.w : el.x;
      elements.push({
        kind: "text",
        template,
        x,
        y: textBaselineY(pageH, el),
        size: el.size,
        font: "body",
        align: el.align,
        color: el.color,
        fontId: el.fontId,
      });
    }
  }
  const bgSrc = design.background ? assets[design.background.assetId] : undefined;
  return {
    page: { ...design.page },
    background: design.background && bgSrc ? { kind: design.background.kind, src: bgSrc } : undefined,
    elements,
  };
}
