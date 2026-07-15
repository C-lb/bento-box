/**
 * Generates the bundled certificate and ticket background PDFs (plus 200px
 * PNG thumbnails for the DesignPanel picker) into
 * packages/web/public/backgrounds/{certificate,ticket}/.
 *
 * Run from the repo root: node scripts/gen-backgrounds.mjs
 *
 * Idempotent: metadata dates are pinned so re-running produces the same
 * bytes for unchanged designs. Vector only, no images, so files stay tiny.
 *
 * Each design is a list of plain shapes in PDF page coordinates (y-up,
 * origin bottom-left) emitted twice: once through pdf-lib for the PDF and
 * once through @napi-rs/canvas (y flipped) for the thumbnail. One source of
 * truth, no drift between the PDF and its preview.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "packages", "web", "public", "backgrounds");

// Default page sizes, matching packages/core/src/certificate.ts (A4
// landscape) and ticket.ts (CELL). The renderer stretches a background to
// the page, but generating at the native size keeps everything crisp.
const CERTIFICATE_PAGE = { width: 841.89, height: 595.28 };
const TICKET_PAGE = { width: 396, height: 144 };

// Anti-vibecode palette: neutral ivory/warm-grey field, one muted warm-gold
// accent used sparingly, no gradients.
const IVORY = "#faf7f0";
const LINE = "#8a8378";
const ACCENT = "#b08d3f";
const BAND = "#f1ece1";

const THUMB_WIDTH = 200;
// Pinned so re-runs are byte-identical.
const PINNED_DATE = new Date("2026-01-01T00:00:00.000Z");

/** @typedef {{ type: "rect", x: number, y: number, w: number, h: number, fill?: string, stroke?: string, strokeWidth?: number, dash?: number[] }} RectShape */
/** @typedef {{ type: "line", x1: number, y1: number, x2: number, y2: number, color: string, width: number, dash?: number[] }} LineShape */
/** @typedef {RectShape | LineShape} Shape */

function field(page, fill = IVORY) {
  return { type: "rect", x: 0, y: 0, w: page.width, h: page.height, fill };
}

function borderRect(page, inset, stroke, strokeWidth) {
  return {
    type: "rect",
    x: inset,
    y: inset,
    w: page.width - 2 * inset,
    h: page.height - 2 * inset,
    stroke,
    strokeWidth,
  };
}

/** Two lines forming an L at each corner, legs pointing inward. */
function cornerAngles(page, inset, leg, color, width) {
  const { width: W, height: H } = page;
  const shapes = [];
  for (const [cx, cy, dx, dy] of [
    [inset, H - inset, 1, -1], // top left
    [W - inset, H - inset, -1, -1], // top right
    [inset, inset, 1, 1], // bottom left
    [W - inset, inset, -1, 1], // bottom right
  ]) {
    shapes.push({ type: "line", x1: cx, y1: cy, x2: cx + dx * leg, y2: cy, color, width });
    shapes.push({ type: "line", x1: cx, y1: cy, x2: cx, y2: cy + dy * leg, color, width });
  }
  return shapes;
}

/** @type {{ tool: string, page: { width: number, height: number }, designs: { id: string, label: string, shapes: Shape[] }[] }[]} */
const SETS = [
  {
    tool: "certificate",
    page: CERTIFICATE_PAGE,
    designs: [
      {
        id: "cert-double-rule",
        label: "Double rule",
        shapes: [
          field(CERTIFICATE_PAGE),
          borderRect(CERTIFICATE_PAGE, 28, LINE, 1.5),
          borderRect(CERTIFICATE_PAGE, 36, ACCENT, 0.75),
        ],
      },
      {
        id: "cert-bottom-bar",
        label: "Bottom bar",
        shapes: [
          field(CERTIFICATE_PAGE),
          { type: "rect", x: 0, y: 0, w: CERTIFICATE_PAGE.width, h: 12, fill: ACCENT },
        ],
      },
      {
        id: "cert-corner-rules",
        label: "Corner rules",
        shapes: [field(CERTIFICATE_PAGE), ...cornerAngles(CERTIFICATE_PAGE, 30, 70, LINE, 1.2)],
      },
      {
        id: "cert-head-rule",
        label: "Head rule",
        shapes: [
          field(CERTIFICATE_PAGE),
          {
            type: "line",
            x1: CERTIFICATE_PAGE.width * 0.34,
            y1: CERTIFICATE_PAGE.height - 96,
            x2: CERTIFICATE_PAGE.width * 0.66,
            y2: CERTIFICATE_PAGE.height - 96,
            color: ACCENT,
            width: 1.5,
          },
        ],
      },
    ],
  },
  {
    tool: "ticket",
    page: TICKET_PAGE,
    designs: [
      {
        id: "ticket-stub",
        label: "Stub band",
        shapes: [
          field(TICKET_PAGE),
          { type: "rect", x: 0, y: 0, w: 96, h: TICKET_PAGE.height, fill: BAND },
          {
            type: "line",
            x1: 96,
            y1: 8,
            x2: 96,
            y2: TICKET_PAGE.height - 8,
            color: LINE,
            width: 1,
            dash: [4, 4],
          },
        ],
      },
      {
        id: "ticket-top-band",
        label: "Top band",
        shapes: [
          field(TICKET_PAGE),
          {
            type: "rect",
            x: 0,
            y: TICKET_PAGE.height - 10,
            w: TICKET_PAGE.width,
            h: 10,
            fill: ACCENT,
          },
        ],
      },
      {
        id: "ticket-thin-border",
        label: "Thin border",
        shapes: [field(TICKET_PAGE), borderRect(TICKET_PAGE, 7, LINE, 0.9)],
      },
      {
        id: "ticket-corner-ticks",
        label: "Corner ticks",
        shapes: [field(TICKET_PAGE), ...cornerAngles(TICKET_PAGE, 10, 16, ACCENT, 1.2)],
      },
    ],
  },
];

function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

async function renderPdf(page, label, shapes) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${label} background`);
  doc.setProducer("event-editor gen-backgrounds");
  doc.setCreator("event-editor gen-backgrounds");
  doc.setCreationDate(PINNED_DATE);
  doc.setModificationDate(PINNED_DATE);
  const p = doc.addPage([page.width, page.height]);
  for (const s of shapes) {
    if (s.type === "rect") {
      p.drawRectangle({
        x: s.x,
        y: s.y,
        width: s.w,
        height: s.h,
        ...(s.fill ? { color: rgb(...hexToRgb01(s.fill)) } : {}),
        ...(s.stroke
          ? { borderColor: rgb(...hexToRgb01(s.stroke)), borderWidth: s.strokeWidth ?? 1 }
          : {}),
        ...(s.dash ? { borderDashArray: s.dash } : {}),
      });
    } else {
      p.drawLine({
        start: { x: s.x1, y: s.y1 },
        end: { x: s.x2, y: s.y2 },
        thickness: s.width,
        color: rgb(...hexToRgb01(s.color)),
        ...(s.dash ? { dashArray: s.dash } : {}),
      });
    }
  }
  return doc.save();
}

function renderThumb(page, shapes) {
  const scale = THUMB_WIDTH / page.width;
  const height = Math.round(page.height * scale);
  const canvas = createCanvas(THUMB_WIDTH, height);
  const ctx = canvas.getContext("2d");
  // PDF y-up -> canvas y-down.
  const Y = (y) => (page.height - y) * scale;
  for (const s of shapes) {
    ctx.setLineDash(s.dash ? s.dash.map((d) => d * scale) : []);
    if (s.type === "rect") {
      const x = s.x * scale;
      const y = (page.height - s.y - s.h) * scale;
      const w = s.w * scale;
      const h = s.h * scale;
      if (s.fill) {
        ctx.fillStyle = s.fill;
        ctx.fillRect(x, y, w, h);
      }
      if (s.stroke) {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = Math.max((s.strokeWidth ?? 1) * scale, 0.6);
        ctx.strokeRect(x, y, w, h);
      }
    } else {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(s.width * scale, 0.6);
      ctx.beginPath();
      ctx.moveTo(s.x1 * scale, Y(s.y1));
      ctx.lineTo(s.x2 * scale, Y(s.y2));
      ctx.stroke();
    }
  }
  return canvas.encode("png");
}

async function main() {
  for (const set of SETS) {
    const dir = path.join(OUT, set.tool);
    await mkdir(dir, { recursive: true });
    for (const design of set.designs) {
      const pdfBytes = await renderPdf(set.page, design.label, design.shapes);
      const pngBytes = await renderThumb(set.page, design.shapes);
      await writeFile(path.join(dir, `${design.id}.pdf`), pdfBytes);
      await writeFile(path.join(dir, `${design.id}.png`), pngBytes);
      console.log(
        `${set.tool}/${design.id}: pdf ${pdfBytes.length} bytes, png ${pngBytes.length} bytes`,
      );
    }
  }
}

await main();
