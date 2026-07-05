// Generates the nav home glyph (components/Nav.tsx) — a bento in the hand-built
// icon style, with compartment layout taken from Caleb's 1.svg reference.
// The tamago swirl is computed here as a JS Archimedean spiral rather than
// hand-drawn. Run `node scripts/gen-home-glyph.mjs` and paste the output into
// the home <Link> in Nav.tsx (converting SVG attrs to JSX camelCase is already done).
//
// Colour contract: tray + food marks = currentColor (inherits the nav's ink text),
// compartments = fill-surface — so the glyph reads and inverts cleanly on a light
// OR dark nav.
const f = (n) => Number(n.toFixed(1));

// 1.svg geometry (600 viewBox): tray + three compartments
const tray = { r: 75 };
const cells = [
  { x: 60, y: 60, w: 202.83, h: 480, r: 45 },     // tall-left rice
  { x: 300, y: 60, w: 240, h: 220.99, r: 45 },     // top-right tomato
  { x: 300, y: 318.57, w: 240, h: 221.43, r: 45 }, // bottom-right tamago
];
const cx = (c) => c.x + c.w / 2;
const cy = (c) => c.y + c.h / 2;

function spiral(x, y, turns, maxR, pts) {
  let d = "";
  for (let i = 0; i <= pts; i++) {
    const t = (turns * 2 * Math.PI * i) / pts;
    const r = (maxR * i) / pts;
    const px = f(x + r * Math.cos(t));
    const py = f(y + r * Math.sin(t));
    d += i ? ` L${px} ${py}` : `M${px} ${py}`;
  }
  return d;
}

const [rice, tom, tam] = cells;
const out = `<svg viewBox="0 0 600 600" width={21} height={21} className="shrink-0" aria-hidden>
  <rect width="600" height="600" rx="${tray.r}" fill="currentColor" />
  <rect x="${rice.x}" y="${rice.y}" width="${rice.w}" height="${rice.h}" rx="${rice.r}" className="fill-surface" />
  <rect x="${tom.x}" y="${tom.y}" width="${tom.w}" height="${tom.h}" rx="${tom.r}" className="fill-surface" />
  <rect x="${tam.x}" y="${tam.y}" width="${tam.w}" height="${tam.h}" rx="${tam.r}" className="fill-surface" />
  <circle cx="${f(cx(rice))}" cy="${f(cy(rice))}" r="34" fill="currentColor" />
  <circle cx="${f(cx(tom))}" cy="${f(cy(tom))}" r="30" fill="currentColor" />
  <path d="${spiral(cx(tam), cy(tam), 2.5, 60, 120)}" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
</svg>`;

console.log(out);
