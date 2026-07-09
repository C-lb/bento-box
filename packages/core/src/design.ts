import type { DocumentSpec, Element } from "./merge.js";

/** mm -> pt conversion factor (1mm = 2.83465pt). */
export const MM_TO_PT = 2.83465;

export interface TextStyle {
  fontId?: string;
  size?: number;
  letterSpacing?: number;
  color?: string;
  /** null explicitly removes an existing stroke; undefined leaves it untouched. */
  stroke?: { color: string; width: number } | null;
}

export interface DesignOverrides {
  v: 1;
  /** New page size in pt. Elements scale proportionally per axis when this differs from the layout's native size. */
  pageSize?: { width: number; height: number };
  border?: { style: "none" | "single" | "double"; color: string; width: number; inset: number };
  /** y is a fraction (0-1) of the page height. */
  dividers?: { y: number; widthFrac: number; color: string; thickness: number }[];
  /** Keyed by the text element's `slot`. */
  text?: Record<string, TextStyle>;
}

/**
 * Applies user design customisation to a layout-produced DocumentSpec.
 * Pure: never mutates `spec` or `o`; always returns a new DocumentSpec.
 */
export function applyDesign(spec: DocumentSpec, o?: DesignOverrides): DocumentSpec {
  const oldW = spec.page.width;
  const oldH = spec.page.height;
  const newW = o?.pageSize?.width ?? oldW;
  const newH = o?.pageSize?.height ?? oldH;
  const sx = newW / oldW;
  const sy = newH / oldH;
  const sMin = Math.min(sx, sy);

  const scaled: Element[] = spec.elements.map((el) => {
    if (el.kind === "text") {
      const next = { ...el, x: el.x * sx, y: el.y * sy, size: el.size * sMin };
      const style = el.slot ? o?.text?.[el.slot] : undefined;
      if (style) {
        if (style.fontId !== undefined) next.fontId = style.fontId;
        if (style.letterSpacing !== undefined) next.letterSpacing = style.letterSpacing;
        if (style.color !== undefined) next.color = style.color;
        if (style.stroke === null) {
          delete next.stroke;
        } else if (style.stroke !== undefined) {
          next.stroke = style.stroke;
        }
        if (style.size !== undefined) next.size = style.size; // absolute, applied after scaling
      }
      return next;
    }
    if (el.kind === "image") {
      return { ...el, x: el.x * sx, y: el.y * sy, width: el.width * sx, height: el.height * sy };
    }
    if (el.kind === "qr") {
      return { ...el, x: el.x * sx, y: el.y * sy, size: el.size * sMin };
    }
    // rect / line: layouts don't currently emit these, but scale defensively if they ever do.
    return { ...el };
  });

  const page = { width: newW, height: newH };
  const extra: Element[] = [];

  if (o?.border && o.border.style !== "none") {
    const { color, width, inset } = o.border;
    extra.push({
      kind: "rect",
      x: inset,
      y: inset,
      width: page.width - 2 * inset,
      height: page.height - 2 * inset,
      strokeColor: color,
      strokeWidth: width,
    });
    if (o.border.style === "double") {
      const inset2 = inset + 3 * width + 4;
      extra.push({
        kind: "rect",
        x: inset2,
        y: inset2,
        width: page.width - 2 * inset2,
        height: page.height - 2 * inset2,
        strokeColor: color,
        strokeWidth: width,
      });
    }
  }

  if (o?.dividers) {
    for (const d of o.dividers) {
      const y = d.y * page.height;
      const w = d.widthFrac * page.width;
      const x1 = (page.width - w) / 2;
      extra.push({ kind: "line", x1, y1: y, x2: x1 + w, y2: y, color: d.color, thickness: d.thickness });
    }
  }

  return {
    page,
    background: spec.background,
    elements: [...scaled, ...extra],
  };
}
