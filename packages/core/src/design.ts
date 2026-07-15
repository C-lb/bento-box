import type { DocumentSpec, Element } from "./merge.js";

/** mm -> pt conversion factor (1mm = 2.83465pt). */
export const MM_TO_PT = 2.83465;

/**
 * Text elements whose y differs by no more than this (pt, in final page
 * coordinates) are treated as the same visual line by the line-spacing
 * shift: same shift, no extra gap between them.
 */
export const LINE_TIE_TOLERANCE_PT = 1;

/** Clamp bounds for `DesignOverrides.lineGap` (pt). */
export const LINE_GAP_MIN = -20;
export const LINE_GAP_MAX = 60;

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
  /**
   * Additive gap (pt) inserted between successive visual text lines,
   * top->bottom; negative pulls the stack tighter. Applied in final page
   * coordinates (i.e. after any `pageSize` scaling).
   */
  lineGap?: number;
  /**
   * Background selection: a bundled registry id, or a user-uploaded asset
   * (assetId into the shared `ee-design-assets` IndexedDB store, same
   * convention as `CustomDesign.background`). `applyDesign` deliberately
   * ignores this (it stays pure — no fetching): the caller resolves the
   * selection to bytes and injects them via `withBackground`. `null`/absent
   * both mean "no background selected". Note `withBackground(spec, null)`
   * leaves an existing `spec.background` in place rather than clearing it;
   * it is an injection seam, not a removal API.
   */
  background?: { id: string } | { assetId: string; kind: "png" | "jpg" | "pdf" } | null;
}

/**
 * Returns a copy of `spec` with `background` set, or `spec` unchanged when
 * `background` is null/undefined. The one seam callers use to inject loaded
 * background bytes (see `DesignOverrides.background`).
 */
export function withBackground(
  spec: DocumentSpec,
  background: DocumentSpec["background"] | null | undefined,
): DocumentSpec {
  if (background == null) return spec;
  return { ...spec, background };
}

/**
 * Shifts stacked text lines apart (or together) by `lineGap` pt per visual
 * line. Elements are ordered top->bottom by descending y (PDF y-up); the
 * first visual line stays fixed and each subsequent line moves down by one
 * more `lineGap`. Elements within `LINE_TIE_TOLERANCE_PT` of a line's anchor
 * share that line's shift. Array order is preserved; only text `y` changes.
 */
function applyLineGap(elements: Element[], lineGap: number): Element[] {
  const texts = elements
    .map((el, i) => ({ el, i }))
    .filter((x): x is { el: Extract<Element, { kind: "text" }>; i: number } => x.el.kind === "text");
  if (texts.length < 2) return elements;

  const byY = [...texts].sort((a, b) => b.el.y - a.el.y);
  const shiftByIndex = new Map<number, number>();
  let line = 0;
  let anchorY = byY[0].el.y;
  shiftByIndex.set(byY[0].i, 0);
  for (let k = 1; k < byY.length; k++) {
    const y = byY[k].el.y;
    if (anchorY - y > LINE_TIE_TOLERANCE_PT) {
      line += 1;
      anchorY = y;
    }
    shiftByIndex.set(byY[k].i, line * lineGap);
  }

  return elements.map((el, i) => {
    const shift = shiftByIndex.get(i);
    if (!shift || el.kind !== "text") return el;
    return { ...el, y: el.y - shift };
  });
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

  // Line spacing runs after scaling (gap is in final page coordinates) and
  // before border/divider appending so only the layout's text slots shift.
  const spaced = o?.lineGap ? applyLineGap(scaled, o.lineGap) : scaled;

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
    elements: [...spaced, ...extra],
  };
}

// ---------------------------------------------------------------------------
// Sanitizer — deep-validates and clamps untrusted (localStorage / preset)
// DesignOverrides values, mirroring web's headshot-style-sanitize.ts style.
// ---------------------------------------------------------------------------

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Page size clamp bounds in pt (20mm–2000mm per side). */
const PAGE_MIN_PT = 20 * MM_TO_PT;
const PAGE_MAX_PT = 2000 * MM_TO_PT;
const MAX_DIVIDERS = 20;
const MAX_TEXT_SLOTS = 40;

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function clampNum(v: unknown, lo: number, hi: number): number | undefined {
  const n = num(v);
  return n == null ? undefined : Math.min(hi, Math.max(lo, n));
}

function hex(v: unknown): string | undefined {
  return typeof v === "string" && HEX.test(v) ? v : undefined;
}

// Per-slot text style: every field validated/clamped; returns undefined when
// nothing valid remains so we never persist empty objects.
function sanitizeTextStyle(raw: unknown): TextStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const fontId = typeof s.fontId === "string" && s.fontId && s.fontId.length <= 200 ? s.fontId : undefined;
  const size = clampNum(s.size, 4, 300);
  const letterSpacing = clampNum(s.letterSpacing, -20, 60);
  const color = hex(s.color);
  let stroke: TextStyle["stroke"];
  if (s.stroke === null) {
    stroke = null;
  } else if (s.stroke && typeof s.stroke === "object") {
    const st = s.stroke as Record<string, unknown>;
    const strokeColor = hex(st.color);
    const strokeWidth = clampNum(st.width, 0.1, 20);
    if (strokeColor && strokeWidth != null) stroke = { color: strokeColor, width: strokeWidth };
  }
  const style: TextStyle = {
    ...(fontId ? { fontId } : {}),
    ...(size != null ? { size } : {}),
    ...(letterSpacing != null ? { letterSpacing } : {}),
    ...(color ? { color } : {}),
    ...(stroke !== undefined ? { stroke } : {}),
  };
  return Object.keys(style).length ? style : undefined;
}

/**
 * Deep-validates and clamps an untrusted value into `DesignOverrides`, or
 * returns undefined when it isn't a v1 overrides object at all. Invalid
 * sub-fields are dropped rather than failing the whole object; numeric
 * fields are clamped to the DesignPanel input ranges (lineGap [-20, 60],
 * page 20–2000mm per side, border width 0.25–20 / inset 0–200, divider
 * y/widthFrac 0.01–1 / thickness 0.25–20, text size 4–300 / tracking -20–60).
 */
export function sanitizeDesignOverrides(value: unknown): DesignOverrides | undefined {
  if (!value || typeof value !== "object") return undefined;
  const s = value as Record<string, unknown>;
  if (s.v !== 1) return undefined;
  const out: DesignOverrides = { v: 1 };

  if (s.pageSize && typeof s.pageSize === "object") {
    const p = s.pageSize as Record<string, unknown>;
    const width = clampNum(p.width, PAGE_MIN_PT, PAGE_MAX_PT);
    const height = clampNum(p.height, PAGE_MIN_PT, PAGE_MAX_PT);
    if (width != null && height != null) out.pageSize = { width, height };
  }

  if (s.border && typeof s.border === "object") {
    const b = s.border as Record<string, unknown>;
    const style = b.style === "none" || b.style === "single" || b.style === "double" ? b.style : undefined;
    const color = hex(b.color);
    const width = clampNum(b.width, 0.25, 20);
    const inset = clampNum(b.inset, 0, 200);
    if (style && color && width != null && inset != null) out.border = { style, color, width, inset };
  }

  if (Array.isArray(s.dividers)) {
    const dividers: NonNullable<DesignOverrides["dividers"]> = [];
    for (const raw of s.dividers.slice(0, MAX_DIVIDERS)) {
      if (!raw || typeof raw !== "object") continue;
      const d = raw as Record<string, unknown>;
      const y = clampNum(d.y, 0.01, 1);
      const widthFrac = clampNum(d.widthFrac, 0.01, 1);
      const color = hex(d.color);
      const thickness = clampNum(d.thickness, 0.25, 20);
      if (y != null && widthFrac != null && color && thickness != null) {
        dividers.push({ y, widthFrac, color, thickness });
      }
    }
    if (dividers.length) out.dividers = dividers;
  }

  if (s.text && typeof s.text === "object" && !Array.isArray(s.text)) {
    const text: Record<string, TextStyle> = {};
    for (const [slot, raw] of Object.entries(s.text).slice(0, MAX_TEXT_SLOTS)) {
      const style = sanitizeTextStyle(raw);
      if (style) text[slot] = style;
    }
    if (Object.keys(text).length) out.text = text;
  }

  const lineGap = clampNum(s.lineGap, LINE_GAP_MIN, LINE_GAP_MAX);
  if (lineGap != null && lineGap !== 0) out.lineGap = lineGap;

  if (s.background === null) {
    out.background = null;
  } else if (s.background && typeof s.background === "object") {
    const b = s.background as Record<string, unknown>;
    if (typeof b.id === "string" && b.id && b.id.length <= 200) {
      out.background = { id: b.id };
    } else if (typeof b.assetId === "string" && b.assetId && b.assetId.length <= 200) {
      const kind = b.kind === "png" || b.kind === "jpg" || b.kind === "pdf" ? b.kind : undefined;
      if (kind) out.background = { assetId: b.assetId, kind };
    }
  }

  return out;
}
