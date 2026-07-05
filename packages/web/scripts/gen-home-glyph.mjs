// Generates the nav home glyph (components/Nav.tsx) — a rounded bento stencil,
// compartment layout taken from Caleb's 1.svg reference but with fatter gaps and
// rounder corners for a more breathable look. Run `node scripts/gen-home-glyph.mjs`
// and paste the output into the home <Link> in Nav.tsx.
//
// Colour contract: tray = currentColor (inherits the nav's ink text), compartments
// = fill-surface — so it reads and inverts cleanly on a light OR dark nav.
//
// Tune breathing room here:
const VB = 600;   // viewBox
const PAD = 64;   // black margin around the outside
const GAP = 60;   // black space between compartments (thicker = more breathable)
const R_TRAY = 96; // outer corner radius
const R_CELL = 52; // compartment corner radius
const LEFT_W = 164; // width of the tall rice column

const inner = VB - 2 * PAD;                 // 472
const rightX = PAD + LEFT_W + GAP;          // start of the right column
const rightW = VB - PAD - rightX;           // right column width
const rightH = (inner - GAP) / 2;           // each right compartment height
const bottomY = PAD + rightH + GAP;

const cells = [
  { x: PAD, y: PAD, w: LEFT_W, h: inner },          // tall-left rice
  { x: rightX, y: PAD, w: rightW, h: rightH },       // top-right
  { x: rightX, y: bottomY, w: rightW, h: rightH },   // bottom-right
];

const rect = (c) =>
  `  <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="${R_CELL}" className="fill-surface" />`;

const out = `<svg viewBox="0 0 ${VB} ${VB}" width={21} height={21} className="shrink-0" aria-hidden>
  <rect width="${VB}" height="${VB}" rx="${R_TRAY}" fill="currentColor" />
${cells.map(rect).join("\n")}
</svg>`;

console.log(out);
