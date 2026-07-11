import {
  PDFDocument,
  StandardFonts,
  rgb,
  setCharacterSpacing,
  setTextRenderingMode,
  setStrokingColor,
  setLineWidth,
  TextRenderingMode,
  type PDFFont,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import JSZip from "jszip";
import { resolveText, type DocumentSpec, type PageSize } from "@event-editor/core/merge";
import { safeBase } from "@event-editor/core/names";
import { nUpGrid } from "@event-editor/core/nup";

export interface FontBytes {
  heading?: Uint8Array;
  body?: Uint8Array;
  /** Additional named fonts, keyed by `fontId`, resolved before the heading/body role. */
  byId?: Record<string, Uint8Array>;
}

interface FontPool {
  heading: PDFFont;
  body: PDFFont;
  byId: Map<string, PDFFont>;
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x111111;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function embedFonts(doc: PDFDocument, spec: DocumentSpec, fonts?: FontBytes): Promise<FontPool> {
  doc.registerFontkit(fontkit);
  const heading: PDFFont = fonts?.heading
    ? await doc.embedFont(fonts.heading)
    : await doc.embedFont(StandardFonts.HelveticaBold);
  const body: PDFFont = fonts?.body
    ? await doc.embedFont(fonts.body)
    : await doc.embedFont(StandardFonts.Helvetica);

  const byId = new Map<string, PDFFont>();
  const fontIds = new Set<string>();
  for (const el of spec.elements) {
    if (el.kind === "text" && el.fontId) fontIds.add(el.fontId);
  }
  for (const id of fontIds) {
    const bytes = fonts?.byId?.[id];
    if (!bytes) continue; // unknown id: resolved per-element via role/standard fallback
    byId.set(id, await doc.embedFont(bytes));
  }
  return { heading, body, byId };
}

function resolveFont(el: { font: "heading" | "body"; fontId?: string }, f: FontPool): PDFFont {
  if (el.fontId) {
    const pooled = f.byId.get(el.fontId);
    if (pooled) return pooled;
  }
  return el.font === "heading" ? f.heading : f.body;
}

type EmbeddedBackground =
  | { kind: "image"; img: import("pdf-lib").PDFImage }
  | { kind: "pdf"; pg: import("pdf-lib").PDFEmbeddedPage };

/** Embeds the spec's background once per output document (reused across pages). */
async function embedBackground(doc: PDFDocument, spec: DocumentSpec): Promise<EmbeddedBackground | undefined> {
  const bg = spec.background;
  if (!bg) return undefined;
  if (bg.kind === "pdf") {
    const [pg] = await doc.embedPdf(bg.src);
    return { kind: "pdf", pg };
  }
  const img = bg.kind === "png" ? await doc.embedPng(bg.src) : await doc.embedJpg(bg.src);
  return { kind: "image", img };
}

function drawBackground(
  page: import("pdf-lib").PDFPage,
  bg: EmbeddedBackground,
  cell: PageSize,
  ox = 0,
  oy = 0,
) {
  if (bg.kind === "pdf") {
    page.drawPage(bg.pg, { x: ox, y: oy, width: cell.width, height: cell.height });
  } else {
    page.drawImage(bg.img, { x: ox, y: oy, width: cell.width, height: cell.height });
  }
}

async function drawPage(
  page: import("pdf-lib").PDFPage,
  spec: DocumentSpec,
  row: Record<string, string>,
  f: FontPool,
  ox = 0,
  oy = 0,
) {
  const doc = page.doc;
  for (const el of spec.elements) {
    if (el.kind === "text") {
      const str = resolveText(el.template, row);
      if (!str) continue;
      const font = resolveFont(el, f);
      const spacing = el.letterSpacing ?? 0;
      const w = font.widthOfTextAtSize(str, el.size) + (str.length - 1) * spacing;
      const x = el.align === "center" ? el.x - w / 2 : el.align === "right" ? el.x - w : el.x;

      if (spacing) page.pushOperators(setCharacterSpacing(spacing));
      if (el.stroke) {
        page.pushOperators(
          setTextRenderingMode(TextRenderingMode.FillAndOutline),
          setStrokingColor(hexToRgb(el.stroke.color)),
          setLineWidth(el.stroke.width),
        );
      }
      page.drawText(str, { x: ox + x, y: oy + el.y, size: el.size, font, color: hexToRgb(el.color) });
      if (el.stroke) page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
      if (spacing) page.pushOperators(setCharacterSpacing(0));
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
    } else if (el.kind === "rect") {
      page.drawRectangle({
        x: ox + el.x,
        y: oy + el.y,
        width: el.width,
        height: el.height,
        borderColor: hexToRgb(el.strokeColor),
        borderWidth: el.strokeWidth,
      });
    } else if (el.kind === "line") {
      page.drawLine({
        start: { x: ox + el.x1, y: oy + el.y1 },
        end: { x: ox + el.x2, y: oy + el.y2 },
        thickness: el.thickness,
        color: hexToRgb(el.color),
      });
    }
  }
}

export async function renderCombined(
  spec: DocumentSpec,
  rows: Record<string, string>[],
  fonts?: FontBytes,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, spec, fonts);
  const bg = await embedBackground(doc, spec);
  for (const row of rows) {
    const page = doc.addPage([spec.page.width, spec.page.height]);
    if (bg) drawBackground(page, bg, spec.page);
    await drawPage(page, spec, row, f);
  }
  return doc.save({ addDefaultPage: false });
}

/** Render a single merged page (also used by {@link MergePreview} for the live WYSIWYG preview). */
export async function renderOne(
  spec: DocumentSpec,
  row: Record<string, string>,
  fonts?: FontBytes,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, spec, fonts);
  const bg = await embedBackground(doc, spec);
  const page = doc.addPage([spec.page.width, spec.page.height]);
  if (bg) drawBackground(page, bg, spec.page);
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

// Cache the in-flight/settled promise so repeated calls (every preview
// render, every download) don't re-fetch (and, on failure, re-404) the
// bundled font files. Cleared on rejection so a transient failure doesn't
// permanently poison later calls.
let bundledFontsPromise: Promise<FontBytes> | undefined;

/** Bundled fallback fonts for the heading/body roles. These MUST point at
 * files that exist under public/ — the old /fonts/heading.ttf and
 * /fonts/body.ttf were removed with the Spec C designer font set and 404'd
 * on every preview render. */
export const BUNDLED_FONT_PATHS = {
  heading: "/fonts/designer/playfair-display-bold.ttf",
  body: "/fonts/designer/dm-sans-regular.ttf",
} as const;

async function fetchBundledFonts(): Promise<FontBytes> {
  const get = async (p: string) => {
    const res = await fetch(p);
    if (!res.ok) throw new Error(`font ${p}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const [heading, body] = await Promise.all([
    get(BUNDLED_FONT_PATHS.heading),
    get(BUNDLED_FONT_PATHS.body),
  ]);
  return { heading, body };
}

export function loadBundledFonts(): Promise<FontBytes> {
  if (!bundledFontsPromise) {
    bundledFontsPromise = fetchBundledFonts().catch((err) => {
      bundledFontsPromise = undefined;
      throw err;
    });
  }
  return bundledFontsPromise;
}

const SHEET_A4: PageSize = { width: 595.28, height: 841.89 };

export interface SheetOptions { sheet?: PageSize; gap?: number; cropMarks?: boolean }

function drawCropMarks(page: import("pdf-lib").PDFPage, x: number, y: number, cell: PageSize) {
  const t = 6; // tick length
  const g = rgb(0.7, 0.7, 0.7);
  const corners: [number, number][] = [
    [x, y], [x + cell.width, y], [x, y + cell.height], [x + cell.width, y + cell.height],
  ];
  for (const [cx, cy] of corners) {
    page.drawLine({ start: { x: cx - t, y: cy }, end: { x: cx + t, y: cy }, thickness: 0.4, color: g });
    page.drawLine({ start: { x: cx, y: cy - t }, end: { x: cx, y: cy + t }, thickness: 0.4, color: g });
  }
}

export async function renderSheet(
  cellSpec: DocumentSpec,
  rows: Record<string, string>[],
  fonts?: FontBytes,
  opts?: SheetOptions,
): Promise<Uint8Array> {
  const sheet = opts?.sheet ?? SHEET_A4;
  const gap = opts?.gap ?? 18;
  const cropMarks = opts?.cropMarks ?? true;

  // nUpGrid clamps cols/rows to a minimum of 1, so it never itself reports
  // "zero placements" for an oversized cell — it would silently place one
  // cell that overflows the sheet. Detect that unclamped case here instead.
  const rawCols = Math.floor((sheet.width + gap) / (cellSpec.page.width + gap));
  const rawRows = Math.floor((sheet.height + gap) / (cellSpec.page.height + gap));
  if (rawCols < 1 || rawRows < 1) {
    throw new Error("Card is too large for the sheet");
  }

  const { placements } = nUpGrid(sheet, cellSpec.page, gap);
  const perPage = placements.length;

  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, cellSpec, fonts);
  const bg = await embedBackground(doc, cellSpec);
  for (let i = 0; i < rows.length; i += perPage) {
    const page = doc.addPage([sheet.width, sheet.height]);
    const slice = rows.slice(i, i + perPage);
    for (let j = 0; j < slice.length; j++) {
      const { x, y } = placements[j];
      if (bg) drawBackground(page, bg, cellSpec.page, x, y);
      if (cropMarks) drawCropMarks(page, x, y, cellSpec.page);
      await drawPage(page, cellSpec, slice[j], f, x, y);
    }
  }
  return doc.save({ addDefaultPage: false });
}
