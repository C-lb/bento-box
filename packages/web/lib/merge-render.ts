import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import JSZip from "jszip";
import { resolveText, type DocumentSpec } from "@event-editor/core/merge";
import { safeBase } from "@event-editor/core/names";

export interface FontBytes { heading?: Uint8Array; body?: Uint8Array }

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x111111;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function embedFonts(doc: PDFDocument, fonts?: FontBytes) {
  doc.registerFontkit(fontkit);
  const heading: PDFFont = fonts?.heading
    ? await doc.embedFont(fonts.heading)
    : await doc.embedFont(StandardFonts.HelveticaBold);
  const body: PDFFont = fonts?.body
    ? await doc.embedFont(fonts.body)
    : await doc.embedFont(StandardFonts.Helvetica);
  return { heading, body };
}

async function drawPage(
  page: import("pdf-lib").PDFPage,
  spec: DocumentSpec,
  row: Record<string, string>,
  f: { heading: PDFFont; body: PDFFont },
  ox = 0,
  oy = 0,
) {
  const doc = page.doc;
  for (const el of spec.elements) {
    if (el.kind === "text") {
      const str = resolveText(el.template, row);
      if (!str) continue;
      const font = el.font === "heading" ? f.heading : f.body;
      const w = font.widthOfTextAtSize(str, el.size);
      const x = el.align === "center" ? el.x - w / 2 : el.align === "right" ? el.x - w : el.x;
      page.drawText(str, { x: ox + x, y: oy + el.y, size: el.size, font, color: hexToRgb(el.color) });
    } else if (el.kind === "image") {
      const png = await doc.embedPng(el.src);
      page.drawImage(png, { x: ox + el.x, y: oy + el.y, width: el.width, height: el.height });
    } else if (el.kind === "qr") {
      const str = resolveText(el.value, row);
      if (!str) continue;
      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(str, { width: Math.round(el.size * 3), margin: 0 });
      const png = await doc.embedPng(dataUrl);
      page.drawImage(png, { x: ox + el.x, y: oy + el.y, width: el.size, height: el.size });
    }
  }
}

export async function renderCombined(
  spec: DocumentSpec,
  rows: Record<string, string>[],
  fonts?: FontBytes,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, fonts);
  for (const row of rows) {
    const page = doc.addPage([spec.page.width, spec.page.height]);
    await drawPage(page, spec, row, f);
  }
  return doc.save({ addDefaultPage: false });
}

async function renderOne(
  spec: DocumentSpec,
  row: Record<string, string>,
  fonts?: FontBytes,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, fonts);
  const page = doc.addPage([spec.page.width, spec.page.height]);
  await drawPage(page, spec, row, f);
  return doc.save();
}

export async function renderZip(
  spec: DocumentSpec,
  rows: Record<string, string>[],
  nameField: string,
  fonts?: FontBytes,
): Promise<Blob> {
  const zip = new JSZip();
  const used = new Map<string, number>();
  for (const row of rows) {
    const base = safeBase(row[nameField] ?? "") || "certificate";
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const name = n === 1 ? `${base}.pdf` : `${base}-${n}.pdf`;
    zip.file(name, await renderOne(spec, row, fonts));
  }
  return zip.generateAsync({ type: "blob" });
}

export async function loadBundledFonts(): Promise<FontBytes> {
  const get = async (p: string) => {
    const res = await fetch(p);
    if (!res.ok) throw new Error(`font ${p}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const [heading, body] = await Promise.all([
    get("/fonts/heading.ttf"),
    get("/fonts/body.ttf"),
  ]);
  return { heading, body };
}
