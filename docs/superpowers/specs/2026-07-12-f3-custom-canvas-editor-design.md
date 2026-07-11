# F3 — Custom canvas editor for the merge tools (+ two bug fixes)

Date: 2026-07-12
Scope: Batch F phase F3 (final phase of the 2026-07-04 batch F spec), plus two
standing bug fixes that ride along.

## Overview

The four merge tools (`/certificate`, `/badge`, `/place-card`, `/ticket`)
currently offer built-in layouts plus the Spec C designer (dimensions,
typography, strokes). F3 adds a **Custom** layout: upload your own background
(a Canva export, typically), then place merge fields and static elements on it
with a drag-and-drop canvas editor. The output pipeline (combined PDF, zip,
N-up cut sheets) is untouched — a custom design is just another `DocumentSpec`
producer.

Two bugs ship in the same batch:

1. **Font 404 noise** — `merge-render.ts` fetches `/fonts/heading.ttf` and
   `/fonts/body.ttf`, which have not existed since the Spec C designer replaced
   them with `public/fonts/designer/*`. Every preview render 404s twice.
2. **`EE_DATA_DIR` ignored by the packaged desktop app** —
   `packages/desktop/main.js` spreads `process.env` and then unconditionally
   overwrites `EE_DATA_DIR`/`EE_BIN_DIR`, so a user-supplied value never takes
   effect.

## Goals

- Fill in names (and other merge fields) on a design made elsewhere, at batch
  scale, without Bento needing to be a design tool.
- Add static text and logo images on top of the background for the cases where
  the export was almost right.
- Keep the editor dependency-free: no canvas library.

## Non-goals

- Blank-canvas design from scratch (shapes, lines, freeform drawing).
- Multiple named templates per tool (one custom design per tool, like the
  existing designer persistence).
- Multi-page backgrounds.

## Decisions (confirmed with Caleb)

| Question | Decision |
|---|---|
| Editor ceiling | Fields + static elements (text blocks, logo images) — no freeform shapes |
| Persistence | One custom design per tool; JSON in localStorage, binary assets in IndexedDB |
| Background formats | PNG/JPG + single-page PDF |
| Editor architecture | DOM-overlay editor on the existing pdfjs live preview; no new deps |

## Architecture

### Editor: DOM overlay on the live preview

The editor canvas is the existing debounced pdfjs raster of the current
`DocumentSpec`, with absolutely-positioned HTML boxes overlaid — one per
element. Boxes are draggable and resizable (pointer events, 8px snap grid);
selecting a box shows its properties in a side panel. Every change updates the
design state; the preview re-renders debounced, same as the Spec C designer.

Rejected alternatives: fabric.js/konva (new dep, big surface for "place boxes
on a rectangle"); numeric x/y form fields (no direct manipulation, bad UX).

### Data model (packages/core/src/design.ts)

```ts
interface CustomElementBase {
  id: string;
  x: number; y: number; w: number; h: number;   // PDF points, top-left origin
}
interface FieldElement extends CustomElementBase {
  type: "field"; field: string;                  // key into the tool's field list
  font: DesignerFontId; size: number; color: string;
  align: "left" | "center" | "right"; bold: boolean;
}
interface TextElement extends CustomElementBase {
  type: "text"; text: string;                    // same styling props as field
  font: DesignerFontId; size: number; color: string;
  align: "left" | "center" | "right"; bold: boolean;
}
interface ImageElement extends CustomElementBase {
  type: "image"; assetId: string;                // key into IndexedDB asset store
}
interface CustomDesign {
  version: 1;
  page: { width: number; height: number };       // PDF points
  background: { assetId: string; kind: "png" | "jpg" | "pdf" } | null;
  elements: (FieldElement | TextElement | ImageElement)[];
}
```

- Coordinates are stored in **PDF points with a top-left origin** (matches how
  people think and how the DOM overlay works); the render layer flips the
  y-axis when drawing with pdf-lib (bottom-left origin). The flip lives in ONE
  function, unit-tested.
- Page size derives from the background: PDF uploads use the page's point
  dimensions verbatim; image uploads assume 300 DPI (points = px × 72 / 300),
  overridable via a size dropdown (A4/Letter/badge/etc. presets from the
  existing tools).

### Persistence

- `localStorage` key `ee.customDesign.<tool>` — the `CustomDesign` JSON.
- IndexedDB store `ee-design-assets` — background and logo bytes keyed by
  `assetId` (localStorage's ~5MB quota can't hold image backgrounds).
- Loading a design whose asset is missing (cleared storage) degrades to a
  "background missing — re-upload" state; elements are kept.

### Render path (packages/web/lib/merge-render.ts)

`renderOne` gains background support: `embedPng`/`embedJpg`/`embedPdf` (page
copy) drawn first at full page size, elements on top. PDF backgrounds keep
vector quality in the output. N-up sheets and zip naming consume the resulting
`DocumentSpec` unchanged.

### UI integration

Each merge tool's layout picker gains a **Custom** tile. Selecting it swaps the
static layout preview for the editor: canvas area (background + overlay boxes),
a toolbar (add field / add text / add image / replace background), and a
properties panel for the selected element (font from the bundled designer set,
size, colour, align, bold, delete). Anti-vibecode rules apply: one accent,
flat buttons, sentence case, SVG icons.

Field boxes render the mapped sample value from row 1 when data is loaded,
otherwise the field name in placeholder style — so the editor doubles as the
preview.

## Bug fixes

1. **Fonts**: `loadBundledFonts()` fetches
   `/fonts/designer/playfair-display-bold.ttf` (heading) and
   `/fonts/designer/dm-sans-regular.ttf` (body) — files that exist — instead
   of the phantom `/fonts/heading.ttf` / `/fonts/body.ttf`. No asset changes.
2. **EE_DATA_DIR**: `packages/desktop/main.js` `serverEnv()` uses
   `process.env.EE_DATA_DIR ?? dataDir` (and the same for `EE_BIN_DIR`,
   which must default relative to the *resolved* data dir) so external
   overrides win over the `userData/data` default.

## Error handling

- Unsupported upload type / multi-page PDF → inline error, design unchanged.
- Oversized upload → cap at 15MB with a clear message.
- Missing asset on load → "re-upload background" state, elements preserved.
- Element dragged off-page → clamped to page bounds on drop.
- Generating with an unmapped field element → block generate, name the field
  (existing merge-tool behaviour).

## Testing

- Core: `CustomDesign` → `DocumentSpec` construction; y-axis flip round-trip;
  page-size derivation (PDF points verbatim, image 300 DPI, preset override).
- Web: render with each background kind (png/jpg/pdf); persistence round-trip
  incl. missing-asset degrade; bug-fix regression (bundled fonts resolve, no
  404 path).
- Desktop: unit-level check that `serverEnv()` respects a preset
  `EE_DATA_DIR`.
- Human smoke (owed by Caleb): real Canva PDF export → upload → place Name +
  logo → batch render 10 rows → combined PDF + zip + N-up all correct.

## Phasing

Single build. The two bug fixes land as the first, independent commits.
