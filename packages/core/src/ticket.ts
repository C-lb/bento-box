import type { DocumentSpec, TextElement, QrElement, Align } from "./merge.js";

export const TICKET_LAYOUTS = [
  { id: "classic", label: "Classic" },
  { id: "minimal", label: "Minimal" },
] as const;

export type TicketLayout = (typeof TICKET_LAYOUTS)[number]["id"];

export interface TicketOptions {
  layout: TicketLayout;
  eventTitle: string;
  nameField: string;
  codeField: string;
  qr: boolean;
}

const CELL = { width: 396, height: 144 };

function text(template: string, x: number, y: number, size: number, font: "heading" | "body", align: Align, color = "#1a1a1a", slot?: string): TextElement {
  return { kind: "text", template, x, y, size, font, align, color, ...(slot ? { slot } : {}) };
}

export function ticketSpec(opts: TicketOptions): DocumentSpec {
  const name = `{${opts.nameField || "Name"}}`;
  const code = `{${opts.codeField || opts.nameField || "Name"}}`;
  const els: (TextElement | QrElement)[] = [];

  if (opts.layout === "classic") {
    if (opts.eventTitle) els.push(text(opts.eventTitle, 24, 104, 14, "heading", "left", "#2563eb", "event"));
    els.push(text(name, 24, 60, 22, "heading", "left", "#1a1a1a", "name"));
    els.push(text("Admit one", 24, 34, 10, "body", "left", "#888888", "detail"));
    if (opts.qr) els.push({ kind: "qr", value: code, x: 396 - 128, y: 17, size: 110 });
  } else {
    const cx = opts.qr ? 176 : CELL.width / 2;
    if (opts.eventTitle) els.push(text(opts.eventTitle, cx, 100, 11, "body", "center", "#888888", "event"));
    els.push(text(name, cx, 60, 22, "heading", "center", "#1a1a1a", "name"));
    if (opts.qr) els.push({ kind: "qr", value: code, x: 396 - 96, y: 40, size: 64 });
  }

  return { page: { ...CELL }, elements: els };
}
