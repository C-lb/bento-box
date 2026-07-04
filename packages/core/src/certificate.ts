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
): TextElement {
  return { kind: "text", template, x: CX, y, size, font, align: "center", color };
}

export function certificateSpec(opts: CertificateOptions): DocumentSpec {
  const recipient = `{${opts.recipientField || "Name"}}`;
  const accent = "#2563eb";
  const els: TextElement[] = [];

  if (opts.layout === "classic") {
    els.push(text(opts.title, 470, 30, "heading", accent));
    els.push(text(opts.bodyLine, 400, 15, "body", "#555555"));
    els.push(text(recipient, 340, 46, "heading"));
    els.push(text(opts.detailLine, 280, 16, "body", "#555555"));
    els.push(text(opts.dateText, 150, 13, "body", "#555555"));
    if (opts.signatureName) els.push(text(opts.signatureName, 110, 15, "heading"));
  } else if (opts.layout === "modern") {
    els.push(text(opts.title, 490, 24, "body", accent));
    els.push(text(recipient, 360, 54, "heading"));
    els.push(text(opts.bodyLine + " " + opts.detailLine, 300, 15, "body", "#555555"));
    els.push(text(opts.dateText, 150, 13, "body", "#888888"));
    if (opts.signatureName) els.push(text(opts.signatureName, 110, 15, "heading"));
  } else {
    // minimal — no signature
    els.push(text(opts.title, 460, 20, "body", "#888888"));
    els.push(text(recipient, 350, 50, "heading"));
    els.push(text(opts.detailLine, 290, 15, "body", "#555555"));
    els.push(text(opts.dateText, 160, 12, "body", "#888888"));
  }

  return { page: { ...A4_LANDSCAPE }, elements: els };
}
