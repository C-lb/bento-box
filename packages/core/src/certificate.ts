import type { DocumentSpec, TextElement } from "./merge.js";

export const CERTIFICATE_LAYOUTS = [
  { id: "classic", label: "Classic" },
  { id: "modern", label: "Modern" },
  { id: "minimal", label: "Minimal" },
] as const;

export type CertificateLayout = (typeof CERTIFICATE_LAYOUTS)[number]["id"];

export interface CertificateOptions {
  layout: CertificateLayout;
  title: string;
  bodyLine: string;
  recipientField: string;
  detailLine: string;
  dateText: string;
  signatureName?: string;
}

const A4_LANDSCAPE = { width: 841.89, height: 595.28 };
const CX = A4_LANDSCAPE.width / 2; // horizontal center

function text(
  template: string,
  y: number,
  size: number,
  font: "heading" | "body",
  color = "#1a1a1a",
  slot?: string,
): TextElement {
  return { kind: "text", template, x: CX, y, size, font, align: "center", color, ...(slot ? { slot } : {}) };
}

export function certificateSpec(opts: CertificateOptions): DocumentSpec {
  const recipient = `{${opts.recipientField || "Name"}}`;
  const accent = "#2563eb";
  const els: TextElement[] = [];

  if (opts.layout === "classic") {
    els.push(text(opts.title, 470, 30, "heading", accent, "title"));
    els.push(text(opts.bodyLine, 400, 15, "body", "#555555", "body"));
    els.push(text(recipient, 340, 46, "heading", "#1a1a1a", "recipient"));
    els.push(text(opts.detailLine, 280, 16, "body", "#555555", "detail"));
    els.push(text(opts.dateText, 150, 13, "body", "#555555", "date"));
    if (opts.signatureName) els.push(text(opts.signatureName, 110, 15, "heading", "#1a1a1a", "signature"));
  } else if (opts.layout === "modern") {
    els.push(text(opts.title, 490, 24, "body", accent, "title"));
    els.push(text(recipient, 360, 54, "heading", "#1a1a1a", "recipient"));
    els.push(text(opts.bodyLine + " " + opts.detailLine, 300, 15, "body", "#555555", "body"));
    els.push(text(opts.dateText, 150, 13, "body", "#888888", "date"));
    if (opts.signatureName) els.push(text(opts.signatureName, 110, 15, "heading", "#1a1a1a", "signature"));
  } else {
    // minimal — no signature or body line
    els.push(text(opts.title, 460, 20, "body", "#888888", "title"));
    els.push(text(recipient, 350, 50, "heading", "#1a1a1a", "recipient"));
    els.push(text(opts.detailLine, 290, 15, "body", "#555555", "detail"));
    els.push(text(opts.dateText, 160, 12, "body", "#888888", "date"));
  }

  return { page: { ...A4_LANDSCAPE }, elements: els };
}
