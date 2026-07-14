// packages/web/lib/headshot-style-sanitize.ts
//
// Server-side validation for the client-supplied HeadshotStyle. Every field is
// validated/clamped and colours are hex-only, so nothing untrusted can reach the
// SVG the renderer builds. Lives in lib/ (not the route) so it stays a plain
// importable/testable module — Next route files may only export HTTP handlers.

import { DESIGNER_FONTS } from "./designer-fonts";
import type { HeadshotStyle, LineStyle, RimSpec } from "@event-editor/core/frames";

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT_IDS = new Set(DESIGNER_FONTS.map((f) => f.id));

function hex(v: unknown): string | undefined {
  return typeof v === "string" && HEX.test(v) ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function clampNum(v: unknown, lo: number, hi: number): number | undefined {
  const n = num(v);
  return n == null ? undefined : Math.min(hi, Math.max(lo, n));
}

// Per-line overrides: booleans plus a clamped size and tracking. Returns
// undefined when the line adds nothing, so we never persist empty objects.
function sanitizeLine(raw: unknown): LineStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const size = clampNum(s.size, 12, 160);
  const tracking = clampNum(s.tracking, -20, 60);
  const line: LineStyle = {
    ...(s.bold ? { bold: true } : {}),
    ...(s.italic ? { italic: true } : {}),
    ...(size != null ? { size } : {}),
    ...(tracking != null && tracking !== 0 ? { tracking } : {}),
  };
  return Object.keys(line).length ? line : undefined;
}

// Circle-frame rim. Drops the whole rim if the mode or every colour is invalid,
// so a malformed rim can never inject into the SVG.
function sanitizeRim(raw: unknown): RimSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const mode = s.mode === "gradient" ? "gradient" : s.mode === "solid" ? "solid" : undefined;
  if (!mode) return undefined;
  const width = clampNum(s.width, 2, 80) ?? 12;
  if (mode === "gradient") {
    const from = hex(s.from);
    const to = hex(s.to);
    if (!from || !to) return undefined;
    const angle = num(s.angle);
    return { mode, width, from, to, angle: angle != null ? ((angle % 360) + 360) % 360 : 0 };
  }
  const color = hex(s.color);
  if (!color) return undefined;
  return { mode, width, color };
}

// Accept only known style fields with validated/clamped values so nothing
// untrusted reaches the SVG we render.
export function sanitizeStyle(raw: unknown): HeadshotStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const color = hex(s.color);
  const zoom = clampNum(s.zoom, 1, 3);
  const fontId = typeof s.fontId === "string" && FONT_IDS.has(s.fontId) ? s.fontId : undefined;
  const companyText =
    typeof s.companyText === "string" && s.companyText.trim() ? s.companyText.slice(0, 120) : undefined;
  const name = sanitizeLine(s.name);
  const title = sanitizeLine(s.title);
  const company = sanitizeLine(s.company);
  const offsetX = clampNum(s.offsetX, -1, 1);
  const offsetY = clampNum(s.offsetY, -1, 1);
  const lineGap = clampNum(s.lineGap, -40, 200);
  const textOffsetY = clampNum(s.textOffsetY, -200, 400);
  const rim = sanitizeRim(s.rim);

  const style: HeadshotStyle = {
    bold: !!s.bold,
    italic: !!s.italic,
    uppercase: !!s.uppercase,
    ...(color ? { color } : {}),
    ...(zoom != null ? { zoom } : {}),
    ...(fontId ? { fontId } : {}),
    ...(companyText ? { companyText } : {}),
    ...(name ? { name } : {}),
    ...(title ? { title } : {}),
    ...(company ? { company } : {}),
    ...(offsetX != null && offsetX !== 0 ? { offsetX } : {}),
    ...(offsetY != null && offsetY !== 0 ? { offsetY } : {}),
    ...(lineGap != null && lineGap !== 0 ? { lineGap } : {}),
    ...(textOffsetY != null && textOffsetY !== 0 ? { textOffsetY } : {}),
    ...(rim ? { rim } : {}),
    ...(s.transparentBg ? { transparentBg: true } : {}),
  };

  // Nothing meaningful set? Don't persist an all-default object.
  const meaningful =
    style.bold ||
    style.italic ||
    style.uppercase ||
    color ||
    (zoom != null && zoom !== 1) ||
    fontId ||
    companyText ||
    name ||
    title ||
    company ||
    (offsetX != null && offsetX !== 0) ||
    (offsetY != null && offsetY !== 0) ||
    (lineGap != null && lineGap !== 0) ||
    (textOffsetY != null && textOffsetY !== 0) ||
    rim ||
    style.transparentBg;
  return meaningful ? style : undefined;
}
