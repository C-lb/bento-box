import type { DocumentSpec, TextElement, QrElement, Align } from "./merge.js";

export const BADGE_LAYOUTS = [
  { id: "centered", label: "Centered" },
  { id: "leftQr", label: "Left with QR" },
] as const;

export type BadgeLayout = (typeof BADGE_LAYOUTS)[number]["id"];

export interface BadgeOptions {
  layout: BadgeLayout;
  nameField: string;
  orgField: string;
  eventTitle: string;
  qr: boolean;
}

const CELL = { width: 288, height: 216 };

function text(template: string, x: number, y: number, size: number, font: "heading" | "body", align: Align, color = "#1a1a1a", slot?: string): TextElement {
  return { kind: "text", template, x, y, size, font, align, color, ...(slot ? { slot } : {}) };
}

export function badgeSpec(opts: BadgeOptions): DocumentSpec {
  const name = `{${opts.nameField || "Name"}}`;
  const org = `{${opts.orgField || "Org"}}`;
  const els: (TextElement | QrElement)[] = [];

  if (opts.layout === "centered") {
    const cx = CELL.width / 2;
    if (opts.eventTitle) els.push(text(opts.eventTitle, cx, 188, 10, "body", "center", "#888888", "event"));
    els.push(text(name, cx, opts.qr ? 128 : 112, 26, "heading", "center", "#1a1a1a", "name"));
    els.push(text(org, cx, opts.qr ? 100 : 84, 13, "body", "center", "#555555", "org"));
    if (opts.qr) els.push({ kind: "qr", value: name, x: cx - 22, y: 14, size: 44 });
  } else {
    // leftQr: text left, QR right
    if (opts.eventTitle) els.push(text(opts.eventTitle, 20, 188, 10, "body", "left", "#888888", "event"));
    els.push(text(name, 20, 120, 24, "heading", "left", "#1a1a1a", "name"));
    els.push(text(org, 20, 96, 13, "body", "left", "#555555", "org"));
    if (opts.qr) els.push({ kind: "qr", value: name, x: 288 - 84, y: 76, size: 64 });
  }

  return { page: { ...CELL }, elements: els };
}
