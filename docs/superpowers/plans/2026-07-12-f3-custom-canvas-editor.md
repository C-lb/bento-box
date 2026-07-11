# F3 Custom Canvas Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Custom" layout to the four merge tools — upload a background (PNG/JPG/1-page PDF), drag merge fields, static text, and logo images onto it — plus fix the bundled-font 404s and the packaged app's `EE_DATA_DIR` override bug.

**Architecture:** A `CustomDesign` (top-left-origin PDF-point coordinates) lives in `packages/core` and compiles to the existing `DocumentSpec`, so the whole render/output pipeline (combined PDF, zip, N-up sheet, live pdfjs preview) is reused untouched. The editor is a DOM overlay of draggable boxes on top of the existing `MergePreview`. JSON persists in localStorage, binary assets (background/logo bytes) in IndexedDB.

**Tech Stack:** TypeScript, Next.js app router, pdf-lib + @pdf-lib/fontkit, pdfjs-dist (existing preview), vitest, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-12-f3-custom-canvas-editor-design.md`

## Global Constraints

- No new npm dependencies.
- Turbopack gotcha: intra-web imports must keep explicit behaviour used by neighbours (`@/lib/...` alias is in use and fine); core is consumed via subpaths (`@event-editor/core/merge`) — **rebuild core (`npm run build -w packages/core`) after any core change** or web picks up stale `dist/`.
- Anti-vibecode UI rules: one accent, flat buttons + dim strokes (never raised/shiny), sentence-case labels, SVG icons (lucide-react, already used), `text-amber-600` not `text-warning`, no em dashes in copy.
- Coordinates in `CustomDesign` are PDF points, **top-left origin**. The y-flip to pdf-lib's bottom-left origin happens ONLY in `customDesignToSpec` (Task 3).
- Asset `src` convention (used by Tasks 3–7): PNG/JPG assets are **data URLs**; PDF assets are **plain base64** (no prefix). Both are accepted by pdf-lib's `embedPng`/`embedJpg`/`embedPdf` respectively.
- Tests: `npm test -w packages/core`, `npm test -w packages/web` (vitest). Keep all existing tests green (271 core / 309 web at time of writing).
- Commit and push to main after each task (Caleb's standing rule).

---

### Task 1: Bug fix — bundled merge fonts 404

The merge preview fetches `/fonts/heading.ttf` and `/fonts/body.ttf`, which
don't exist (Spec C moved fonts to `public/fonts/designer/`). Point the
loader at real files and add a regression test that the paths exist on disk.

**Files:**
- Modify: `packages/web/lib/merge-render.ts:176-188` (the `fetchBundledFonts` block)
- Test: `packages/web/test/bundled-fonts.test.ts` (create)

**Interfaces:**
- Produces: `export const BUNDLED_FONT_PATHS = { heading: string; body: string }` from `@/lib/merge-render`. No caller changes; `loadBundledFonts()` keeps its signature.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/bundled-fonts.test.ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { BUNDLED_FONT_PATHS } from "../lib/merge-render";

describe("bundled merge fonts", () => {
  it("every bundled font path maps to a real file under public/", () => {
    for (const p of Object.values(BUNDLED_FONT_PATHS)) {
      const onDisk = resolve(__dirname, "..", "public", "." + p);
      expect(existsSync(onDisk), `${p} missing at ${onDisk}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w packages/web -- test/bundled-fonts.test.ts`
Expected: FAIL — `BUNDLED_FONT_PATHS` is not exported.

- [ ] **Step 3: Implement**

In `packages/web/lib/merge-render.ts`, above `fetchBundledFonts`:

```ts
/** Bundled fallback fonts for the heading/body roles. These MUST point at
 * files that exist under public/ — the old /fonts/heading.ttf and
 * /fonts/body.ttf were removed with the Spec C designer font set and 404'd
 * on every preview render. */
export const BUNDLED_FONT_PATHS = {
  heading: "/fonts/designer/playfair-display-bold.ttf",
  body: "/fonts/designer/dm-sans-regular.ttf",
} as const;
```

and in `fetchBundledFonts` replace the two `get(...)` calls:

```ts
  const [heading, body] = await Promise.all([
    get(BUNDLED_FONT_PATHS.heading),
    get(BUNDLED_FONT_PATHS.body),
  ]);
```

- [ ] **Step 4: Run tests**

Run: `npm test -w packages/web -- test/bundled-fonts.test.ts` → PASS.
Run: `npm test -w packages/web` → all green (no other test touches these paths).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/merge-render.ts packages/web/test/bundled-fonts.test.ts
git commit -m "fix(design): bundled merge fonts point at real designer files, not the removed heading/body.ttf"
git push
```

---

### Task 2: Bug fix — packaged app clobbers EE_DATA_DIR / EE_BIN_DIR

`packages/desktop/main.js` `serverEnv()` spreads `process.env` then
unconditionally sets `EE_DATA_DIR`/`EE_BIN_DIR`, so external overrides never
take effect. Extract the directory resolution into a pure, testable helper.

**Files:**
- Create: `packages/desktop/lib/dirs.js`
- Create: `packages/desktop/test/dirs.test.mjs`
- Modify: `packages/desktop/main.js:50-70` (`serverEnv`)
- Modify: `packages/desktop/package.json` (add `"test": "node --test test/"` to scripts)

**Interfaces:**
- Produces: `resolveDirs(env, userDataDir) -> { dataDir: string, binDir: string }` (CommonJS export from `packages/desktop/lib/dirs.js`). `env` is a plain object read for `EE_DATA_DIR`/`EE_BIN_DIR` only.

- [ ] **Step 1: Write the failing test**

```js
// packages/desktop/test/dirs.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { resolveDirs } = require("../lib/dirs.js");

test("defaults to userData/data and dataDir/bin", () => {
  const { dataDir, binDir } = resolveDirs({}, "/Users/x/Library/Application Support/Bento");
  assert.equal(dataDir, path.join("/Users/x/Library/Application Support/Bento", "data"));
  assert.equal(binDir, path.join(dataDir, "bin"));
});

test("EE_DATA_DIR override wins and binDir follows it", () => {
  const { dataDir, binDir } = resolveDirs({ EE_DATA_DIR: "/tmp/ee-data" }, "/ignored");
  assert.equal(dataDir, path.resolve("/tmp/ee-data"));
  assert.equal(binDir, path.join(path.resolve("/tmp/ee-data"), "bin"));
});

test("EE_BIN_DIR override wins independently", () => {
  const { binDir } = resolveDirs({ EE_BIN_DIR: "/opt/ee-bin" }, "/u");
  assert.equal(binDir, path.resolve("/opt/ee-bin"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --test test/`
Expected: FAIL — cannot find `../lib/dirs.js`.

- [ ] **Step 3: Implement**

```js
// packages/desktop/lib/dirs.js
const path = require("path");

/**
 * Resolves the server's data and bin directories. External EE_DATA_DIR /
 * EE_BIN_DIR overrides win over the packaged defaults (userData/data and
 * <dataDir>/bin) — previously serverEnv() clobbered them unconditionally.
 */
function resolveDirs(env, userDataDir) {
  const dataDir = env.EE_DATA_DIR
    ? path.resolve(env.EE_DATA_DIR)
    : path.join(userDataDir, "data");
  const binDir = env.EE_BIN_DIR
    ? path.resolve(env.EE_BIN_DIR)
    : path.join(dataDir, "bin");
  return { dataDir, binDir };
}

module.exports = { resolveDirs };
```

In `main.js`, add near the other requires: `const { resolveDirs } = require("./lib/dirs.js");`
then in `serverEnv()` replace the two lines:

```js
  const userData = app.getPath("userData");
  const { dataDir, binDir } = resolveDirs(process.env, userData);
  mkdirSync(dataDir, { recursive: true });
```

and in the returned object replace the two entries:

```js
    EE_DATA_DIR: dataDir,
    EE_BIN_DIR: binDir,
```

(The derived paths — `EE_DB_PATH`, `EE_HEADSHOT_DIR`, `EE_THUMBS_DIR` — already build from `dataDir`, so they follow the override automatically. That is the intended behaviour.)

Add to `packages/desktop/package.json` scripts: `"test": "node --test test/"`.

- [ ] **Step 4: Run tests**

Run: `cd packages/desktop && npm test` → 3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/lib/dirs.js packages/desktop/test/dirs.test.mjs packages/desktop/main.js packages/desktop/package.json
git commit -m "fix(desktop): external EE_DATA_DIR/EE_BIN_DIR overrides win over the packaged userData default"
git push
```

---

### Task 3: Core — CustomDesign model and compiler to DocumentSpec

Pure, unit-tested core: the `CustomDesign` type, the top-left→bottom-left
y-flip, page-size derivation for image uploads, and `customDesignToSpec`.
Also retypes `DocumentSpec.background` (currently an unused `string`).

**Files:**
- Modify: `packages/core/src/merge.ts:46-49` (retype `background`)
- Create: `packages/core/src/custom-design.ts`
- Test: `packages/core/src/custom-design.test.ts`
- Modify: `packages/core/package.json` — confirm subpath export pattern and add `./custom-design` matching how `./design` is exported (copy that entry exactly, adjusting the name).

**Interfaces:**
- Consumes: `DocumentSpec`, `Element`, `Align`, `PageSize` from `./merge.js`.
- Produces (all from `@event-editor/core/custom-design`):
  - `interface CustomTextStyle { fontId?: string; size: number; color: string; align: Align }`
  - `type CustomElement = ({ type:"field"; field: string } | { type:"text"; text: string }) & CustomTextStyle & Box | { type:"image"; assetId: string } & Box` where `Box = { id: string; x: number; y: number; w: number; h: number }`
  - `interface CustomDesign { v: 1; page: PageSize; background: { assetId: string; kind: "png"|"jpg"|"pdf" } | null; elements: CustomElement[] }`
  - `customDesignToSpec(design: CustomDesign, assets: Record<string, string>): DocumentSpec`
  - `textBaselineY(pageH: number, el: { y: number; size: number }): number`
  - `pageSizeFromImage(pxW: number, pxH: number): PageSize` (300 DPI assumption)
  - `newElementId(): string`
- Bold is delivered via the bold font variants already in the designer registry (`dm-sans-bold`, etc.) through `fontId` — there is no separate bold flag. (Disclosed deviation from the spec's element sketch; same capability, less state.)

- [ ] **Step 1: Retype the background field**

In `packages/core/src/merge.ts` replace `background?: string;` with:

```ts
  /** Full-page background drawn before elements. PNG/JPG src is a data URL;
   * PDF src is plain base64 of a single-page document. */
  background?: { kind: "png" | "jpg" | "pdf"; src: string };
```

Run: `npm run build -w packages/core && npx tsc --noEmit -p packages/web` — the only in-repo reference is the pass-through in `design.ts:105`, so this compiles clean. If anything else surfaces, fix it in this step.

- [ ] **Step 2: Write the failing tests**

```ts
// packages/core/src/custom-design.test.ts
import { describe, it, expect } from "vitest";
import {
  customDesignToSpec, textBaselineY, pageSizeFromImage, newElementId,
  type CustomDesign,
} from "./custom-design.js";

const page = { width: 400, height: 300 };

function design(partial: Partial<CustomDesign>): CustomDesign {
  return { v: 1, page, background: null, elements: [], ...partial };
}

describe("textBaselineY", () => {
  it("flips top-left y to a bottom-left baseline below the box top", () => {
    // box top at y=50, size 20 → baseline = 300 - 50 - 20*0.75 = 235
    expect(textBaselineY(300, { y: 50, size: 20 })).toBeCloseTo(235);
  });
});

describe("pageSizeFromImage", () => {
  it("assumes 300 DPI (px * 72 / 300)", () => {
    expect(pageSizeFromImage(1500, 900)).toEqual({ width: 360, height: 216 });
  });
});

describe("customDesignToSpec", () => {
  it("compiles a field element to a text element with a {token} template", () => {
    const spec = customDesignToSpec(design({
      elements: [{ id: "a", type: "field", field: "Name", x: 10, y: 50, w: 200, h: 30, size: 20, color: "#112233", align: "left" }],
    }), {});
    expect(spec.page).toEqual(page);
    expect(spec.elements).toEqual([
      { kind: "text", template: "{Name}", x: 10, y: textBaselineY(300, { y: 50, size: 20 }), size: 20, font: "body", align: "left", color: "#112233", fontId: undefined },
    ]);
  });

  it("anchors center/right alignment to the box center/right edge", () => {
    const base = { id: "a", type: "text" as const, text: "hi", y: 0, w: 100, h: 20, size: 10, color: "#000000" };
    const spec = customDesignToSpec(design({
      elements: [
        { ...base, x: 10, align: "center" },
        { ...base, x: 10, align: "right" },
      ],
    }), {});
    expect(spec.elements[0]).toMatchObject({ x: 60 });  // 10 + 100/2
    expect(spec.elements[1]).toMatchObject({ x: 110 }); // 10 + 100
  });

  it("compiles image elements with a bottom-left y and resolves the asset src", () => {
    const spec = customDesignToSpec(design({
      elements: [{ id: "a", type: "image", assetId: "logo", x: 10, y: 20, w: 60, h: 40 }],
    }), { logo: "data:image/png;base64,AAAA" });
    expect(spec.elements).toEqual([
      { kind: "image", src: "data:image/png;base64,AAAA", x: 10, y: 300 - 20 - 40, width: 60, height: 40 },
    ]);
  });

  it("drops image elements whose asset is missing", () => {
    const spec = customDesignToSpec(design({
      elements: [{ id: "a", type: "image", assetId: "gone", x: 0, y: 0, w: 10, h: 10 }],
    }), {});
    expect(spec.elements).toEqual([]);
  });

  it("resolves the background asset, and omits background when its asset is missing", () => {
    const withBg = design({ background: { assetId: "bg", kind: "pdf" } });
    expect(customDesignToSpec(withBg, { bg: "QkFTRTY0" }).background).toEqual({ kind: "pdf", src: "QkFTRTY0" });
    expect(customDesignToSpec(withBg, {}).background).toBeUndefined();
  });
});

describe("newElementId", () => {
  it("returns unique non-empty ids", () => {
    const a = newElementId();
    expect(a).toBeTruthy();
    expect(newElementId()).not.toEqual(a);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w packages/core -- custom-design`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// packages/core/src/custom-design.ts
import type { DocumentSpec, Element, Align, PageSize } from "./merge.js";

interface Box { id: string; x: number; y: number; w: number; h: number }

export interface CustomTextStyle {
  /** Designer-registry or `upload:` font id; undefined = bundled body font.
   * Bold comes from picking a bold variant id (e.g. "dm-sans-bold"). */
  fontId?: string;
  size: number;
  color: string;
  align: Align;
}

export type CustomElement =
  | (Box & CustomTextStyle & { type: "field"; field: string })
  | (Box & CustomTextStyle & { type: "text"; text: string })
  | (Box & { type: "image"; assetId: string });

export interface CustomDesign {
  v: 1;
  /** PDF points. */
  page: PageSize;
  background: { assetId: string; kind: "png" | "jpg" | "pdf" } | null;
  /** Coordinates in PDF points, TOP-LEFT origin. The y-flip to pdf-lib's
   * bottom-left origin happens only here, in customDesignToSpec. */
  elements: CustomElement[];
}

/** Approximate ascent fraction used to place a text baseline inside the top
 * of its box, so rendered output lands where the editor overlay shows it. */
const ASCENT = 0.75;

export function textBaselineY(pageH: number, el: { y: number; size: number }): number {
  return pageH - el.y - el.size * ASCENT;
}

/** Image uploads assume 300 DPI: points = px * 72 / 300. */
export function pageSizeFromImage(pxW: number, pxH: number): PageSize {
  return { width: (pxW * 72) / 300, height: (pxH * 72) / 300 };
}

let idCounter = 0;
export function newElementId(): string {
  idCounter += 1;
  return `el-${idCounter}-${idCounter.toString(36)}${(idCounter * 2654435761 % 4294967296).toString(36)}`;
}

/**
 * Compiles a CustomDesign into the render pipeline's DocumentSpec.
 * `assets` maps assetId -> src (data URL for png/jpg, base64 for pdf).
 * Elements with missing assets are dropped (the UI shows a re-upload state).
 */
export function customDesignToSpec(design: CustomDesign, assets: Record<string, string>): DocumentSpec {
  const pageH = design.page.height;
  const elements: Element[] = [];
  for (const el of design.elements) {
    if (el.type === "image") {
      const src = assets[el.assetId];
      if (!src) continue;
      elements.push({ kind: "image", src, x: el.x, y: pageH - el.y - el.h, width: el.w, height: el.h });
    } else {
      const template = el.type === "field" ? `{${el.field}}` : el.text;
      const x = el.align === "center" ? el.x + el.w / 2 : el.align === "right" ? el.x + el.w : el.x;
      elements.push({
        kind: "text",
        template,
        x,
        y: textBaselineY(pageH, el),
        size: el.size,
        font: "body",
        align: el.align,
        color: el.color,
        fontId: el.fontId,
      });
    }
  }
  const bgSrc = design.background ? assets[design.background.assetId] : undefined;
  return {
    page: { ...design.page },
    background: design.background && bgSrc ? { kind: design.background.kind, src: bgSrc } : undefined,
    elements,
  };
}
```

`newElementId` must not use `Math.random`/`Date.now`? No such constraint in app code — but keep it deterministic-free anyway is unnecessary; if the counter feels contrived, `crypto.randomUUID()` is available in all our targets and is acceptable — pick one and keep the uniqueness test green.

- [ ] **Step 5: Run tests, build core**

Run: `npm test -w packages/core` → all green (existing 271 + new).
Run: `npm run build -w packages/core` (required so web sees the new subpath).
Run: `npx vitest run -w packages/web` → still green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/merge.ts packages/core/src/custom-design.ts packages/core/src/custom-design.test.ts packages/core/package.json
git commit -m "feat(core): CustomDesign model compiles to DocumentSpec (typed background, y-flip, 300dpi sizing)"
git push
```

---

### Task 4: Renderer — draw DocumentSpec backgrounds (png/jpg/pdf)

`renderOne`, `renderCombined`, and `renderSheet` draw the background (when
present) before elements. PDF backgrounds embed as vector pages.

**Files:**
- Modify: `packages/web/lib/merge-render.ts` (`drawPage` callers; new `embedBackground`/`drawBackground` helpers)
- Test: `packages/web/test/merge-render-background.test.ts` (create)

**Interfaces:**
- Consumes: `DocumentSpec.background?: { kind: "png"|"jpg"|"pdf"; src: string }` (Task 3).
- Produces: no signature changes — `renderOne(spec, row, fonts)`, `renderCombined(spec, rows, fonts)`, `renderSheet(cellSpec, rows, fonts, opts)` all behave as before when `background` is absent.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/web/test/merge-render-background.test.ts
import { describe, it, expect } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { renderOne, renderCombined, renderSheet } from "../lib/merge-render";
import type { DocumentSpec } from "@event-editor/core/merge";

// 1x1 red PNG
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function onePagePdfBase64(): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  page.drawRectangle({ x: 0, y: 0, width: 200, height: 100, color: rgb(0.9, 0.2, 0.2) });
  return doc.saveAsBase64();
}

function spec(background: DocumentSpec["background"]): DocumentSpec {
  return {
    page: { width: 200, height: 100 },
    background,
    elements: [{ kind: "text", template: "{Name}", x: 10, y: 50, size: 12, font: "body", align: "left", color: "#000000" }],
  };
}

describe("background rendering", () => {
  it("renderOne with a png background produces a loadable 1-page pdf", async () => {
    const bytes = await renderOne(spec({ kind: "png", src: PNG_DATA_URL }), { Name: "Ada" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("renderOne with a pdf background embeds the page", async () => {
    const bytes = await renderOne(spec({ kind: "pdf", src: await onePagePdfBase64() }), { Name: "Ada" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // pdf background must render LARGER than the no-background version
    const plain = await renderOne(spec(undefined), { Name: "Ada" });
    expect(bytes.length).toBeGreaterThan(plain.length);
  });

  it("renderCombined draws the background on every page", async () => {
    const bytes = await renderCombined(spec({ kind: "png", src: PNG_DATA_URL }), [{ Name: "A" }, { Name: "B" }]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("renderSheet tiles cells with backgrounds without throwing", async () => {
    const bytes = await renderSheet(spec({ kind: "jpg", src: PNG_DATA_URL.replace("image/png", "image/png") }), [{ Name: "A" }, { Name: "B" }]);
    // NOTE: pdf-lib embedJpg would reject actual png bytes; use kind "png" here instead:
    expect(bytes.length).toBeGreaterThan(0);
  });
});
```

(In the sheet test, use `{ kind: "png", src: PNG_DATA_URL }` — the inline note above is the reminder; don't ship a jpg-typed png.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w packages/web -- test/merge-render-background.test.ts`
Expected: FAIL — pages load but the pdf-background size assertion fails / backgrounds ignored (whichever fires first; any red is fine, the point is the helpers don't exist yet).

- [ ] **Step 3: Implement**

In `packages/web/lib/merge-render.ts` add below `embedFonts`:

```ts
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
```

Wire it into the three render paths (each already embeds fonts once, then draws pages):

- `renderCombined`: after `const f = await embedFonts(...)` add `const bg = await embedBackground(doc, spec);` and inside the row loop, after `addPage`, add `if (bg) drawBackground(page, bg, spec.page);` before `drawPage(...)`.
- `renderOne`: same two lines around its single `addPage`.
- `renderSheet`: embed once from `cellSpec`; inside the per-cell placement loop add `if (bg) drawBackground(page, bg, cellSpec.page, x, y);` immediately before that cell's `drawPage(page, cellSpec, row, f, x, y)` call (same `x`/`y` offsets the cell uses, and before crop marks so marks stay visible).

- [ ] **Step 4: Run tests**

Run: `npm test -w packages/web -- test/merge-render-background.test.ts` → PASS.
Run: `npm test -w packages/web` → all green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/merge-render.ts packages/web/test/merge-render-background.test.ts
git commit -m "feat(design): render DocumentSpec backgrounds (png/jpg data URLs, vector pdf pages) across all output paths"
git push
```

---

### Task 5: Web — asset store (IndexedDB), custom-design store (localStorage), upload intake

**Files:**
- Create: `packages/web/lib/design-assets.ts`
- Create: `packages/web/components/custom-design-store.ts`
- Create: `packages/web/lib/custom-upload.ts`
- Test: `packages/web/test/custom-design-store.test.ts`, `packages/web/test/custom-upload.test.ts`

**Interfaces:**
- Produces:
  - `design-assets.ts`: `putAsset(id: string, bytes: Uint8Array, mime: string): Promise<void>`, `getAsset(id: string): Promise<{ bytes: Uint8Array; mime: string } | undefined>`, `deleteAsset(id: string): Promise<void>`. All no-op (resolve undefined) when `indexedDB` is unavailable (SSR).
  - `custom-design-store.ts`: `loadCustomDesign(toolId: string): CustomDesign | undefined`, `saveCustomDesign(toolId: string, d: CustomDesign): void`, `clearCustomDesign(toolId: string): void` — key `ee.customDesign.<toolId>`, defensive parse, mirrors `design-store.ts` exactly.
  - `custom-upload.ts`:
    - `MAX_UPLOAD_BYTES = 15 * 1024 * 1024`
    - `assetSrc(kind: "png"|"jpg"|"pdf", bytes: Uint8Array): string` — data URL for images, plain base64 for pdf (pure; unit-tested).
    - `readBackgroundUpload(file: File): Promise<{ kind: "png"|"jpg"|"pdf"; bytes: Uint8Array; page: PageSize }>` — rejects with a user-facing `Error` message on: unsupported type, >15MB, multi-page pdf. PDF page size via `PDFDocument.load(bytes).getPage(0).getSize()`; image size via `createImageBitmap` then `pageSizeFromImage`.
    - `readLogoUpload(file: File): Promise<Uint8Array>` — accepts png/jpg, re-encodes jpg to PNG via canvas (`drawImage` + `toBlob("image/png")`) so the renderer's `embedPng` path handles all logos; passes png through untouched.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/web/test/custom-design-store.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadCustomDesign, saveCustomDesign, clearCustomDesign } from "../components/custom-design-store";
import type { CustomDesign } from "@event-editor/core/custom-design";

const design: CustomDesign = { v: 1, page: { width: 100, height: 50 }, background: null, elements: [] };

describe("custom-design-store", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });

  it("round-trips a design per tool", () => {
    saveCustomDesign("certificate", design);
    expect(loadCustomDesign("certificate")).toEqual(design);
    expect(loadCustomDesign("badge")).toBeUndefined();
  });

  it("clears", () => {
    saveCustomDesign("certificate", design);
    clearCustomDesign("certificate");
    expect(loadCustomDesign("certificate")).toBeUndefined();
  });

  it("rejects malformed payloads", () => {
    (window as unknown as { localStorage: Storage }).localStorage.setItem("ee.customDesign.certificate", "{\"v\":99}");
    expect(loadCustomDesign("certificate")).toBeUndefined();
  });
});
```

```ts
// packages/web/test/custom-upload.test.ts
import { describe, it, expect } from "vitest";
import { assetSrc, MAX_UPLOAD_BYTES } from "../lib/custom-upload";

describe("assetSrc", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  it("images become data URLs", () => {
    expect(assetSrc("png", bytes)).toBe("data:image/png;base64,AQID");
    expect(assetSrc("jpg", bytes)).toBe("data:image/jpeg;base64,AQID");
  });
  it("pdf becomes plain base64", () => {
    expect(assetSrc("pdf", bytes)).toBe("AQID");
  });
});

describe("upload cap", () => {
  it("is 15MB", () => expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024));
});
```

(`readBackgroundUpload`/`readLogoUpload` depend on `createImageBitmap`/canvas — browser-only, covered by the human smoke; the pure parts are unit-tested.)

- [ ] **Step 2: Run tests to verify they fail** — module not found. Run the two files via `npm test -w packages/web -- test/custom-design-store.test.ts test/custom-upload.test.ts`.

- [ ] **Step 3: Implement the three files**

```ts
// packages/web/components/custom-design-store.ts
/** Per-tool persistence for the F3 custom canvas design, keyed by tool id in
 * localStorage (binary assets live in IndexedDB — see lib/design-assets.ts).
 * Defensive parse mirrors design-store.ts. */
import type { CustomDesign } from "@event-editor/core/custom-design";

const KEY_PREFIX = "ee.customDesign.";

function keyFor(toolId: string): string {
  return `${KEY_PREFIX}${toolId}`;
}

function isCustomDesign(x: unknown): x is CustomDesign {
  return !!x && typeof x === "object"
    && (x as { v?: unknown }).v === 1
    && Array.isArray((x as { elements?: unknown }).elements)
    && !!(x as { page?: { width?: unknown } }).page;
}

export function loadCustomDesign(toolId: string): CustomDesign | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(keyFor(toolId));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return isCustomDesign(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveCustomDesign(toolId: string, d: CustomDesign): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(toolId), JSON.stringify(d));
  } catch {
    // quota exceeded or storage disabled: drop silently
  }
}

export function clearCustomDesign(toolId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(toolId));
  } catch {
    // storage disabled: nothing to clean up
  }
}
```

```ts
// packages/web/lib/design-assets.ts
/** IndexedDB store for F3 design binaries (backgrounds, logos). localStorage
 * can't hold multi-MB images; the JSON design references these by assetId. */

const DB_NAME = "ee-design-assets";
const STORE = "assets";

function openDb(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function putAsset(id: string, bytes: Uint8Array, mime: string): Promise<void> {
  await withStore("readwrite", (s) => s.put({ bytes, mime }, id));
}

export async function getAsset(id: string): Promise<{ bytes: Uint8Array; mime: string } | undefined> {
  const v = await withStore<{ bytes: Uint8Array; mime: string } | undefined>("readonly", (s) => s.get(id) as IDBRequest<{ bytes: Uint8Array; mime: string } | undefined>);
  return v ?? undefined;
}

export async function deleteAsset(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}
```

```ts
// packages/web/lib/custom-upload.ts
/** Background/logo upload intake for the F3 custom canvas editor. */
import { PDFDocument } from "pdf-lib";
import { pageSizeFromImage } from "@event-editor/core/custom-design";
import type { PageSize } from "@event-editor/core/merge";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type BackgroundKind = "png" | "jpg" | "pdf";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** src convention consumed by customDesignToSpec + the renderer:
 * data URL for images (usable by <img> and embedPng/embedJpg),
 * plain base64 for pdf (usable by embedPdf). */
export function assetSrc(kind: BackgroundKind, bytes: Uint8Array): string {
  const b64 = toBase64(bytes);
  if (kind === "pdf") return b64;
  return `data:image/${kind === "jpg" ? "jpeg" : "png"};base64,${b64}`;
}

function kindOf(file: File): BackgroundKind | undefined {
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "application/pdf") return "pdf";
  return undefined;
}

export async function readBackgroundUpload(
  file: File,
): Promise<{ kind: BackgroundKind; bytes: Uint8Array; page: PageSize }> {
  const kind = kindOf(file);
  if (!kind) throw new Error("Use a PNG, JPG or single-page PDF.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Background is over 15MB. Export a smaller file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === "pdf") {
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 1) throw new Error("PDF backgrounds must be a single page.");
    const { width, height } = doc.getPage(0).getSize();
    return { kind, bytes, page: { width, height } };
  }
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: file.type }));
  try {
    return { kind, bytes, page: pageSizeFromImage(bmp.width, bmp.height) };
  } finally {
    bmp.close();
  }
}

/** Logos are normalised to PNG so the renderer's embedPng path covers all of them. */
export async function readLogoUpload(file: File): Promise<Uint8Array> {
  const kind = kindOf(file);
  if (kind !== "png" && kind !== "jpg") throw new Error("Use a PNG or JPG logo.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Logo is over 15MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === "png") return bytes;
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: file.type }));
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not read the logo image.");
  return new Uint8Array(await blob.arrayBuffer());
}
```

- [ ] **Step 4: Run tests** — the two new files pass; whole web suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/design-assets.ts packages/web/components/custom-design-store.ts packages/web/lib/custom-upload.ts packages/web/test/custom-design-store.test.ts packages/web/test/custom-upload.test.ts
git commit -m "feat(design): F3 persistence and upload intake (IndexedDB assets, per-tool design store, background/logo readers)"
git push
```

---

### Task 6: Web — CustomDesignEditor component

The drag/resize overlay editor. No tests beyond compile (pure DOM
interaction; covered by the integration task's behaviour tests + human
smoke) — but the geometry helper is extracted and unit-tested.

**Files:**
- Create: `packages/web/components/CustomDesignEditor.tsx`
- Create: `packages/web/components/custom-editor-geometry.ts`
- Test: `packages/web/test/custom-editor-geometry.test.ts`

**Interfaces:**
- Consumes: `CustomDesign`, `CustomElement`, `newElementId` (core); `MergePreview` (`spec`, `row`, `fonts`, `className` props); `BUNDLED_FONTS` + `listUploadedFonts()` from `@/lib/designer-fonts` (the font registry export is named `BUNDLED_FONTS` — verify the exact export name in `designer-fonts.ts` at implementation time and use it); `readBackgroundUpload`, `readLogoUpload`, `assetSrc` (Task 5); `putAsset` (Task 5).
- Produces:

```ts
export interface CustomDesignEditorProps {
  design: CustomDesign;
  onChange: (d: CustomDesign) => void;           // parent persists + re-renders preview
  fields: { key: string; label: string }[];      // the tool's merge fields
  spec: DocumentSpec;                            // compiled custom spec (parent computes)
  sampleRow: Record<string, string>;
  previewFonts: FontBytes | undefined;
  assets: Record<string, string>;                // hydrated assetId -> src
  onAssetAdded: (id: string, src: string) => void; // parent updates the hydrated map
  onError: (msg: string) => void;
}
export function CustomDesignEditor(props: CustomDesignEditorProps): JSX.Element;
```

- `custom-editor-geometry.ts`:

```ts
export interface DragState { mode: "move" | "resize"; startX: number; startY: number; orig: { x: number; y: number; w: number; h: number } }
/** Applies a pointer delta (in page points) to a box, clamping to the page and an 8pt minimum size, snapping to an 8pt grid. */
export function applyDrag(state: DragState, dxPt: number, dyPt: number, page: PageSize): { x: number; y: number; w: number; h: number };
```

- [ ] **Step 1: Write the failing geometry tests**

```ts
// packages/web/test/custom-editor-geometry.test.ts
import { describe, it, expect } from "vitest";
import { applyDrag, type DragState } from "../components/custom-editor-geometry";

const page = { width: 400, height: 300 };
const orig = { x: 40, y: 40, w: 80, h: 40 };

describe("applyDrag", () => {
  it("move: offsets and snaps to the 8pt grid", () => {
    const s: DragState = { mode: "move", startX: 0, startY: 0, orig };
    expect(applyDrag(s, 13, 5, page)).toEqual({ x: 56, y: 48, w: 80, h: 40 });
  });
  it("move: clamps inside the page", () => {
    const s: DragState = { mode: "move", startX: 0, startY: 0, orig };
    expect(applyDrag(s, -999, -999, page)).toEqual({ x: 0, y: 0, w: 80, h: 40 });
    expect(applyDrag(s, 999, 999, page)).toEqual({ x: 320, y: 260, w: 80, h: 40 });
  });
  it("resize: grows from the bottom-right handle with an 8pt floor", () => {
    const s: DragState = { mode: "resize", startX: 0, startY: 0, orig };
    expect(applyDrag(s, 21, 10, page)).toEqual({ x: 40, y: 40, w: 104, h: 48 });
    expect(applyDrag(s, -999, -999, page)).toEqual({ x: 40, y: 40, w: 8, h: 8 });
  });
  it("resize: cannot extend past the page edge", () => {
    const s: DragState = { mode: "resize", startX: 0, startY: 0, orig };
    expect(applyDrag(s, 9999, 9999, page)).toEqual({ x: 40, y: 40, w: 360, h: 260 });
  });
});
```

- [ ] **Step 2: Run to verify fail**, then implement the helper:

```ts
// packages/web/components/custom-editor-geometry.ts
import type { PageSize } from "@event-editor/core/merge";

export interface DragState {
  mode: "move" | "resize";
  startX: number;
  startY: number;
  orig: { x: number; y: number; w: number; h: number };
}

const GRID = 8;
const MIN = 8;
const snap = (v: number) => Math.round(v / GRID) * GRID;

export function applyDrag(
  state: DragState,
  dxPt: number,
  dyPt: number,
  page: PageSize,
): { x: number; y: number; w: number; h: number } {
  const { orig } = state;
  if (state.mode === "move") {
    const x = Math.min(Math.max(snap(orig.x + dxPt), 0), page.width - orig.w);
    const y = Math.min(Math.max(snap(orig.y + dyPt), 0), page.height - orig.h);
    return { x, y, w: orig.w, h: orig.h };
  }
  const w = Math.min(Math.max(snap(orig.w + dxPt), MIN), page.width - orig.x);
  const h = Math.min(Math.max(snap(orig.h + dyPt), MIN), page.height - orig.y);
  return { x: orig.x, y: orig.y, w, h };
}
```

Run: geometry tests PASS.

- [ ] **Step 3: Implement the editor component**

```tsx
// packages/web/components/CustomDesignEditor.tsx
"use client";
import { useRef, useState } from "react";
import { Plus, Type, Image as ImageIcon, Upload, Trash2 } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { MergePreview } from "@/components/MergePreview";
import {
  newElementId,
  type CustomDesign,
  type CustomElement,
} from "@event-editor/core/custom-design";
import type { DocumentSpec, PageSize } from "@event-editor/core/merge";
import type { FontBytes } from "@/lib/merge-render";
import { readBackgroundUpload, readLogoUpload, assetSrc } from "@/lib/custom-upload";
import { putAsset } from "@/lib/design-assets";
import { applyDrag, type DragState } from "@/components/custom-editor-geometry";
// Font options: use the designer registry (verify export name in designer-fonts.ts)
import { BUNDLED_FONTS, listUploadedFonts } from "@/lib/designer-fonts";

export interface CustomDesignEditorProps {
  design: CustomDesign;
  onChange: (d: CustomDesign) => void;
  fields: { key: string; label: string }[];
  spec: DocumentSpec;
  sampleRow: Record<string, string>;
  previewFonts: FontBytes | undefined;
  assets: Record<string, string>;
  onAssetAdded: (id: string, src: string) => void;
  onError: (msg: string) => void;
}

const DEFAULT_TEXT = { size: 24, color: "#111111", align: "left" as const };

export function CustomDesignEditor(p: CustomDesignEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<(DragState & { id: string }) | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const selected = p.design.elements.find((e) => e.id === selectedId) ?? null;
  const page = p.design.page;

  /** px-per-pt scale of the on-screen stage (overlay coords <-> page points). */
  function scale(): number {
    const w = stageRef.current?.clientWidth ?? page.width;
    return w / page.width;
  }

  function update(elements: CustomElement[]) {
    p.onChange({ ...p.design, elements });
  }

  function patchSelected(patch: Partial<CustomElement>) {
    if (!selected) return;
    update(p.design.elements.map((e) => (e.id === selected.id ? ({ ...e, ...patch } as CustomElement) : e)));
  }

  function addField(fieldKey: string) {
    const id = newElementId();
    update([
      ...p.design.elements,
      { id, type: "field", field: fieldKey, x: 40, y: 40, w: Math.min(240, page.width - 80), h: 32, ...DEFAULT_TEXT },
    ]);
    setSelectedId(id);
  }

  function addText() {
    const id = newElementId();
    update([
      ...p.design.elements,
      { id, type: "text", text: "Text", x: 40, y: 88, w: Math.min(200, page.width - 80), h: 28, ...DEFAULT_TEXT, size: 16 },
    ]);
    setSelectedId(id);
  }

  async function addLogo(file: File) {
    try {
      const bytes = await readLogoUpload(file);
      const assetId = newElementId();
      await putAsset(assetId, bytes, "image/png");
      const src = assetSrc("png", bytes);
      p.onAssetAdded(assetId, src);
      const id = newElementId();
      update([...p.design.elements, { id, type: "image", assetId, x: 40, y: 140, w: 96, h: 96 }]);
      setSelectedId(id);
    } catch (e) {
      p.onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function setBackground(file: File) {
    try {
      const { kind, bytes, page: pg } = await readBackgroundUpload(file);
      const assetId = newElementId();
      await putAsset(assetId, bytes, kind === "pdf" ? "application/pdf" : `image/${kind === "jpg" ? "jpeg" : "png"}`);
      p.onAssetAdded(assetId, assetSrc(kind, bytes));
      p.onChange({ ...p.design, page: pg, background: { assetId, kind } });
    } catch (e) {
      p.onError(e instanceof Error ? e.message : String(e));
    }
  }

  function onPointerDown(e: React.PointerEvent, el: CustomElement, mode: "move" | "resize") {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(el.id);
    dragRef.current = { id: el.id, mode, startX: e.clientX, startY: e.clientY, orig: { x: el.x, y: el.y, w: el.w, h: el.h } };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const s = scale();
    const box = applyDrag(d, (e.clientX - d.startX) / s, (e.clientY - d.startY) / s, page);
    update(p.design.elements.map((el) => (el.id === d.id ? { ...el, ...box } : el)));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  const fontOptions: { id: string; label: string }[] = [
    { id: "", label: "Default" },
    ...BUNDLED_FONTS.map((f: { id: string; label: string }) => ({ id: f.id, label: f.label })),
    ...listUploadedFonts().map((f) => ({ id: f.id, label: f.label })),
  ];

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap gap-2">
        <label className="btn inline-flex items-center gap-2 cursor-pointer">
          <Upload className="w-4 h-4" strokeWidth={1.75} />
          {p.design.background ? "Replace background" : "Upload background"}
          <input ref={bgInputRef} type="file" accept="image/png,image/jpeg,application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void setBackground(f); e.target.value = ""; }} />
        </label>
        <div className="relative">
          <select className="field" value="" onChange={(e) => { if (e.target.value) addField(e.target.value); }}
            aria-label="Add a merge field">
            <option value="">Add field…</option>
            {p.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <button className="btn inline-flex items-center gap-2" onClick={addText}>
          <Type className="w-4 h-4" strokeWidth={1.75} /> Add text
        </button>
        <label className="btn inline-flex items-center gap-2 cursor-pointer">
          <ImageIcon className="w-4 h-4" strokeWidth={1.75} /> Add logo
          <input ref={logoInputRef} type="file" accept="image/png,image/jpeg" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void addLogo(f); e.target.value = ""; }} />
        </label>
      </div>

      {/* background-missing degrade */}
      {p.design.background && !p.assets[p.design.background.assetId] && (
        <p className="text-sm text-amber-600">Background image is no longer stored on this device. Re-upload it; your placed elements are kept.</p>
      )}

      {/* stage: live preview + overlay */}
      <div
        ref={stageRef}
        className="relative select-none touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={() => setSelectedId(null)}
      >
        <MergePreview spec={p.spec} row={p.sampleRow} fonts={p.previewFonts} />
        {/* overlay boxes, positioned as % of the stage so they track responsive width */}
        {p.design.elements.map((el) => {
          const sel = el.id === selectedId;
          return (
            <div
              key={el.id}
              role="button"
              tabIndex={0}
              aria-label={el.type === "field" ? `Field ${el.type === "field" ? el.field : ""}` : el.type}
              onPointerDown={(e) => onPointerDown(e, el, "move")}
              className={`absolute cursor-move rounded-sm ${sel ? "ring-2 ring-accent" : "ring-1 ring-black/20 hover:ring-black/40"}`}
              style={{
                left: `${(el.x / page.width) * 100}%`,
                top: `${(el.y / page.height) * 100}%`,
                width: `${(el.w / page.width) * 100}%`,
                height: `${(el.h / page.height) * 100}%`,
              }}
            >
              {sel && (
                <div
                  onPointerDown={(e) => onPointerDown(e, el, "resize")}
                  className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-sm bg-accent cursor-nwse-resize"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* properties panel */}
      {selected && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {selected.type === "field" ? `Field: ${selected.field}` : selected.type === "text" ? "Text" : "Logo"}
            </p>
            <button className="btn inline-flex items-center gap-2" onClick={() => { update(p.design.elements.filter((e) => e.id !== selected.id)); setSelectedId(null); }}>
              <Trash2 className="w-4 h-4" strokeWidth={1.75} /> Remove
            </button>
          </div>
          {selected.type !== "image" && (
            <div className="grid grid-cols-2 gap-3">
              {selected.type === "text" && (
                <label className="col-span-2 block text-sm font-medium">Text
                  <input className="field mt-1 w-full" value={selected.text} onChange={(e) => patchSelected({ text: e.target.value })} />
                </label>
              )}
              <label className="block text-sm font-medium">Font
                <select className="field mt-1 w-full" value={selected.fontId ?? ""} onChange={(e) => patchSelected({ fontId: e.target.value || undefined })}>
                  {fontOptions.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Size
                <input className="field mt-1 w-full" type="number" min={6} max={200} value={selected.size}
                  onChange={(e) => patchSelected({ size: Math.min(200, Math.max(6, Number(e.target.value) || 6)) })} />
              </label>
              <label className="block text-sm font-medium">Colour
                <input className="field mt-1 w-full h-10" type="color" value={selected.color} onChange={(e) => patchSelected({ color: e.target.value })} />
              </label>
              <div className="block text-sm font-medium">Align
                <div className="mt-1">
                  <Segmented
                    options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]}
                    value={selected.align}
                    onChange={(v) => patchSelected({ align: v as "left" | "center" | "right" })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

Implementation notes for this step (not optional):
- Verify `Segmented`'s prop names against `packages/web/components/Segmented.tsx` before use (it's used in `MergeToolClient` with `options/value/onChange`, so this shape is right — just confirm the option `label`/`value` keys).
- Verify the designer font registry's export name in `packages/web/lib/designer-fonts.ts` (the array at line ~25 — it may be named `BUNDLED_FONTS`, `DESIGNER_FONTS`, or similar) and import accordingly.
- `ring-accent`/`bg-accent` — check `globals.css`/tailwind config for the accent utility actually used elsewhere (`btn-accent` exists); if there's no `ring-accent` utility, use the same colour token the designer panel uses for active states.
- The `aria-label` ternary above is awkward — clean it to: fields → `Field <name>`, text → `Text element`, image → `Logo`.

- [ ] **Step 4: Compile check**

Run: `npx tsc --noEmit -p packages/web` — only the 5 known pre-existing errors (none from the new files).
Run: `npm test -w packages/web` → green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/CustomDesignEditor.tsx packages/web/components/custom-editor-geometry.ts packages/web/test/custom-editor-geometry.test.ts
git commit -m "feat(design): F3 canvas editor (drag/resize overlay on the live preview, background/logo upload, properties panel)"
git push
```

---

### Task 7: Integration — Custom layout mode in MergeToolClient

Wire the editor into all four tools via the shared client: a "Custom"
layout option, design/asset hydration, spec switching, and hiding the
built-in-layout controls (copy fields, DesignPanel) in custom mode.

**Files:**
- Modify: `packages/web/components/MergeToolClient.tsx`
- Test: `packages/web/test/custom-integration.test.ts` (create)

**Interfaces:**
- Consumes: everything produced by Tasks 3–6.
- Produces: `CUSTOM_LAYOUT_ID = "__custom"` exported from `MergeToolClient.tsx`. No `MergeToolConfig` changes — every tool gets Custom for free.

- [ ] **Step 1: Write the failing integration test**

The pure seam worth testing here: a custom design + hydrated assets produce a spec whose derived fields feed the existing mapping. (`deriveFields` comes from `@event-editor/core/merge` — confirm at implementation time that it scans text templates for `{tokens}`; it powers the existing tools' mapping, so field elements' `{Name}` templates flow through the same path.)

```ts
// packages/web/test/custom-integration.test.ts
import { describe, it, expect } from "vitest";
import { customDesignToSpec, type CustomDesign } from "@event-editor/core/custom-design";
import { deriveFields, autoMatchColumns } from "@event-editor/core/merge";

const design: CustomDesign = {
  v: 1,
  page: { width: 400, height: 300 },
  background: null,
  elements: [
    { id: "1", type: "field", field: "Name", x: 10, y: 10, w: 100, h: 20, size: 14, color: "#000000", align: "left" },
    { id: "2", type: "field", field: "Org", x: 10, y: 40, w: 100, h: 20, size: 12, color: "#000000", align: "left" },
    { id: "3", type: "text", text: "Certificate of participation", x: 10, y: 70, w: 200, h: 20, size: 12, color: "#000000", align: "left" },
  ],
};

describe("custom design feeds the existing merge pipeline", () => {
  it("field elements surface as mappable fields; static text does not", () => {
    const spec = customDesignToSpec(design, {});
    const fields = deriveFields(spec);
    expect(fields).toContain("Name");
    expect(fields).toContain("Org");
    expect(fields).not.toContain("Certificate of participation");
  });

  it("auto-matching binds custom fields to sheet columns", () => {
    const spec = customDesignToSpec(design, {});
    const mapping = autoMatchColumns(deriveFields(spec), ["Full Name", "Org", "Email"]);
    expect(mapping["Org"]).toBe("Org");
  });
});
```

(If `deriveFields` returns a different shape — e.g. objects — adapt the assertions to its real signature; the intent is fixed: Name/Org mappable, static text not.)

- [ ] **Step 2: Run to verify it fails** (module resolution of custom-design through core dist is the likely first failure if core wasn't rebuilt — `npm run build -w packages/core` first).

- [ ] **Step 3: Modify MergeToolClient.tsx**

Additions (keep everything existing intact):

```tsx
import { CustomDesignEditor } from "@/components/CustomDesignEditor";
import { loadCustomDesign, saveCustomDesign } from "@/components/custom-design-store";
import { getAsset } from "@/lib/design-assets";
import { assetSrc } from "@/lib/custom-upload";
import { customDesignToSpec, type CustomDesign } from "@event-editor/core/custom-design";

export const CUSTOM_LAYOUT_ID = "__custom";

const EMPTY_CUSTOM: CustomDesign = {
  v: 1,
  page: { width: 841.89, height: 595.28 }, // A4 landscape default until a background sets the size
  background: null,
  elements: [],
};
```

New state + hydration (after the `overrides` block):

```tsx
  const [customDesign, setCustomDesign] = useState<CustomDesign>(EMPTY_CUSTOM);
  const [customAssets, setCustomAssets] = useState<Record<string, string>>({});
  useEffect(() => {
    const saved = loadCustomDesign(config.toolId);
    if (!saved) return;
    setCustomDesign(saved);
    // hydrate every referenced asset from IndexedDB into src strings
    const ids = new Set<string>();
    if (saved.background) ids.add(saved.background.assetId);
    for (const el of saved.elements) if (el.type === "image") ids.add(el.assetId);
    void Promise.all(Array.from(ids).map(async (id) => {
      const a = await getAsset(id);
      if (!a) return null;
      const kind = a.mime === "application/pdf" ? "pdf" as const : a.mime === "image/jpeg" ? "jpg" as const : "png" as const;
      return [id, assetSrc(kind, a.bytes)] as const;
    })).then((pairs) => {
      setCustomAssets(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => !!p)));
    });
  }, [config.toolId]);

  function changeCustomDesign(next: CustomDesign) {
    setCustomDesign(next);
    saveCustomDesign(config.toolId, next);
  }
```

Spec switching (replace the two existing `spec`/`finalSpec` memos):

```tsx
  const isCustom = layout === CUSTOM_LAYOUT_ID;
  const spec = useMemo(
    () => isCustom
      ? customDesignToSpec(customDesign, customAssets)
      : config.buildSpec({ layout, text, toggles, recipientField }),
    [config, isCustom, customDesign, customAssets, layout, text, toggles, recipientField],
  );
  // Designer overrides apply to built-in layouts only; a custom design IS the design.
  const finalSpec = useMemo(() => (isCustom ? spec : applyDesign(spec, overrides)), [isCustom, spec, overrides]);
```

Layout picker: add the option — `options={[...config.layouts.map((l) => ({ value: l.id, label: l.label })), { value: CUSTOM_LAYOUT_ID, label: "Custom" }]}`.

Controls block: in custom mode, render the editor instead of the copy
fields + DesignPanel (recipient input stays — zip naming still needs it),
and skip the separate `MergePreview` column (the editor stage contains it):

```tsx
          {isCustom ? (
            <div className="lg:col-span-2">
              <CustomDesignEditor
                design={customDesign}
                onChange={changeCustomDesign}
                fields={config.copyFields.map((f) => ({ key: f.key, label: f.label })).concat([{ key: config.recipientDefault, label: config.recipientLabel }])}
                spec={finalSpec}
                sampleRow={mergedRows[0] ?? EMPTY_ROW}
                previewFonts={previewFonts}
                assets={customAssets}
                onAssetAdded={(id, src) => setCustomAssets((s) => ({ ...s, [id]: src }))}
                onError={setError}
              />
              <label className="block text-sm font-medium mt-3">{config.recipientLabel}
                <input className="field mt-1 w-full min-h-[44px] sm:min-h-0" value={recipientField} onChange={(e) => setRecipientField(e.target.value)} />
              </label>
            </div>
          ) : (
            /* existing two-column preview + controls JSX, unchanged */
          )}
```

Structure note: the existing grid wraps both columns; restructure minimally — the cleanest is to make the ternary the direct child of the `lg:grid` wrapper, with the existing two `<div>` columns as the else branch, exactly as they are today. Don't rework the layout beyond this.

Also: the "Add field" list for custom mode is the tool's copy fields + recipient — for `/certificate` that yields e.g. Title/Body/Date/Signature + Name. That is the correct field vocabulary per tool; no hardcoded lists.

- [ ] **Step 4: Run everything**

Run: `npm run build -w packages/core && npm test -w packages/core && npm test -w packages/web` → all green.
Run: `npx tsc --noEmit -p packages/web` → only the 5 pre-existing errors.
Run: `npm run dev -w packages/web` and click through `/certificate` → Custom: upload a PNG, add a Name field, drag it, reload the page (design + background survive), paste two names, download combined PDF + zip. Check the browser console: **no `/fonts/heading.ttf` 404s** (Task 1 regression, verified live here).

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/MergeToolClient.tsx packages/web/test/custom-integration.test.ts
git commit -m "feat(design): Custom layout on all four merge tools wires the F3 canvas editor into the merge pipeline"
git push
```

---

### Task 8: Whole-feature verification

- [ ] Full suites: `npm test -w packages/core && npm test -w packages/web && (cd packages/desktop && npm test)` — all green.
- [ ] `npx tsc --noEmit -p packages/web` — no new errors beyond the 5 pre-existing.
- [ ] Dev-server click-through of all four tools: built-in layouts unaffected (layout picker, designer panel, downloads); Custom mode works on at least `/certificate` and `/badge` (badge exercises the N-up sheet with a background).
- [ ] `EE_DATA_DIR=/tmp/ee-smoke npm run dev` (or the desktop dev runner) — confirm data lands under `/tmp/ee-smoke`.
- [ ] Update project memory topic file; note the human-smoke Caleb owes: real Canva PDF export end-to-end.

---

## Self-review notes

- Spec coverage: fields+static elements (T3/T6), png/jpg/pdf backgrounds (T4/T5), per-tool persistence with IndexedDB assets and missing-asset degrade (T5/T6/T7), page-size derivation incl. PDF-points-verbatim and 300 DPI (T3/T5), both bug fixes (T1/T2), error handling (upload validation T5, off-page clamp T6 geometry, unmapped-field block = existing pipeline behaviour). Preset page-size override for image backgrounds was in the spec ("overridable via a size dropdown") — **descoped to follow-up**: the background defines the size in v1; note this in the tool copy if it comes up. Disclosed deviation.
- Bold flag → bold font variants via `fontId` (disclosed in Task 3).
- Type consistency: `CustomDesign`/`CustomElement`/`assetSrc`/`applyDrag` signatures match across Tasks 3–7; `spec.background` shape matches between core (T3) and renderer (T4).
