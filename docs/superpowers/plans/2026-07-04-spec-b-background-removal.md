# Spec B Batch E — Background Removal (MediaPipe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side "Remove a background" tool (`cutout`, `/cutout`) to the event-editor tool shell — drop photos of people, get transparent-PNG cutouts, all in the browser.

**Architecture:** Fully client-side (QR-tool shape). `@mediapipe/tasks-vision` (Apache-2.0) runs a selfie/person segmentation model in the browser via WebAssembly; the photo never leaves the machine. The per-pixel person-confidence mask becomes an alpha matte the client applies on a `<canvas>`. WASM + model assets are self-hosted under `packages/web/public/mediapipe/` (copied/downloaded at pre-build), so it works offline and ships in the packaged desktop app with NO native module. Pure helpers live in `packages/core/src/cutout.ts`; no API route, no `lib/` module, no job dir.

**Tech Stack:** TypeScript, Next.js (client component), React, canvas 2D, vitest. New dep: `@mediapipe/tasks-vision`. (Replaces the AGPL `@imgly/background-removal` from the prior draft.)

## Global Constraints

- **Client-only tool.** NO `app/api/cutout/**`, NO `packages/web/lib/cutout.ts`, NO job dir. All processing in the browser. (A route or job dir = over-build finding.)
- **Person-focused, honest copy.** The selfie segmenter is for people; the tool copy says "Best for photos of people." NO em dashes in user copy.
- **Core subpath export:** add `"./cutout": "./dist/cutout.js"` to `packages/core/package.json` `exports`; after any `packages/core/src` change run `npm run build` in `packages/core`. Core test imports use the `.js` extension.
- **Self-hosted assets:** `@mediapipe/tasks-vision` must load its WASM via `FilesetResolver.forVisionTasks("/mediapipe/wasm")` and its model via `baseOptions.modelAssetPath: "/mediapipe/<model>.tflite"` — from the app's own origin, never a Google CDN.
- **SSR safety:** `CutoutClient` is `"use client"`; `import("@mediapipe/tasks-vision")` and segmenter creation happen INSIDE the run handler, never at module top level.
- **Object-URL cleanup:** revoke result URLs on row removal AND on unmount via a ref synced to the live rows (the splice-tool pattern), NOT a `useEffect([])` closure over the initial rows.
- **Serial processing:** one file at a time (memory), not `Promise.all`.
- **House UI:** `.card`, `.field`, `.btn`, `.btn-accent`, `.eyebrow`, `.text-muted`, `.text-danger`, `Segmented` (`@/components/Segmented`), `Loader2`. Primary "Remove backgrounds" button is `.btn-accent` (one accent per view). Sentence-case, no em dashes.
- **`packages/web` has 5 PRE-EXISTING `tsc --noEmit` errors** (test/docs.test.ts + test/canva-oauth.test.ts). "Clean" = NO NEW errors from this task's files.
- **Commits:** conventional, atomic, body ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Push to `main` after each task.

## File Structure

- Task 1: `packages/web/scripts/fetch-mediapipe-assets.mjs` (create); `packages/web/package.json` (deps + `predev`/`prebuild`); `.gitignore` (add `packages/web/public/mediapipe/`).
- Task 2: `packages/core/src/cutout.ts` + `packages/core/test/cutout.test.ts` (create); `packages/core/package.json` (export); `packages/web/app/cutout/page.tsx` + `packages/web/app/cutout/CutoutClient.tsx` (create).
- Task 3: `packages/web/components/tools.ts` (add one entry).

---

## Task 1: MediaPipe asset infrastructure

**Files:**
- Create: `packages/web/scripts/fetch-mediapipe-assets.mjs`
- Modify: `packages/web/package.json` (deps + `predev`/`prebuild`)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `public/mediapipe/wasm/*` (copied from the npm package) and `public/mediapipe/<model>.tflite` (downloaded), present before `next dev`/`next build`. Records the exact `wasm` path, model filename, and model URL for Task 2.

- [ ] **Step 1: Install and confirm the license**

Run: `cd packages/web && npm install @mediapipe/tasks-vision`
Then confirm license: `node -e "const p=require('@mediapipe/tasks-vision/package.json'); console.log(p.version, p.license)"`.
Expected: license `Apache-2.0`. Record it in your report. If it is NOT Apache-2.0 / a permissive license, STOP and report (the whole point of this switch was a permissive license).

- [ ] **Step 2: Locate the package WASM folder and pick the model**

Run: `cd packages/web && ls node_modules/@mediapipe/tasks-vision/wasm | head`
Expected: `.wasm` + `.js` loader files (e.g. `vision_wasm_internal.wasm`, `vision_wasm_internal.js`). This folder is what `FilesetResolver.forVisionTasks` needs.
Model: use the single-class selfie segmenter. Canonical URL:
`https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`
Record in your report: the wasm dir contents, the model filename (`selfie_segmenter.tflite`), and the model URL. If that URL 404s, find the current selfie segmenter model URL from the MediaPipe Image Segmenter model card and use it (report the substitution).

- [ ] **Step 3: Write the asset script**

`packages/web/scripts/fetch-mediapipe-assets.mjs`:
```javascript
// Self-host MediaPipe's WASM runtime + selfie segmenter model under public/ so the
// browser loads them from our own origin (offline, private) instead of a Google CDN.
// Runs on predev/prebuild. Dest is git-ignored (a copy/download of a dependency).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const destDir = resolve(here, "..", "public", "mediapipe");
const wasmDest = resolve(destDir, "wasm");
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const modelDest = resolve(destDir, "selfie_segmenter.tflite");

// 1. Copy the WASM runtime from the installed package.
const pkgJson = require.resolve("@mediapipe/tasks-vision/package.json");
const wasmSrc = resolve(dirname(pkgJson), "wasm");
if (!existsSync(wasmSrc)) {
  console.error(`[mediapipe-assets] wasm source not found: ${wasmSrc}`);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
rmSync(wasmDest, { recursive: true, force: true });
cpSync(wasmSrc, wasmDest, { recursive: true });
console.log(`[mediapipe-assets] copied wasm -> ${wasmDest}`);

// 2. Download the model once (skip if already present).
if (existsSync(modelDest)) {
  console.log(`[mediapipe-assets] model already present, skipping download`);
} else {
  const res = await fetch(modelUrl);
  if (!res.ok) {
    console.error(`[mediapipe-assets] model download failed: ${res.status} ${modelUrl}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(modelDest, buf);
  console.log(`[mediapipe-assets] downloaded model (${buf.length} bytes) -> ${modelDest}`);
}
```

(Node 18+ has global `fetch`; the repo runs Node 24, so this is fine.)

- [ ] **Step 4: Wire predev/prebuild + gitignore**

In `packages/web/package.json` `scripts`, add:
```json
"predev": "node scripts/fetch-mediapipe-assets.mjs",
"prebuild": "node scripts/fetch-mediapipe-assets.mjs"
```
In `.gitignore`, add:
```
packages/web/public/mediapipe/
```

- [ ] **Step 5: Verify assets land**

Run: `cd packages/web && node scripts/fetch-mediapipe-assets.mjs && ls -R public/mediapipe | head -30`
Expected: `wasm/` populated and `selfie_segmenter.tflite` present (~250KB).
Run: `cd packages/web && npx tsc --noEmit`
Expected: only the 5 pre-existing errors (this task adds no TS).

- [ ] **Step 6: Commit**

```bash
git add packages/web/scripts/fetch-mediapipe-assets.mjs packages/web/package.json packages/web/package-lock.json .gitignore
git commit -m "feat(cutout): self-host MediaPipe wasm + selfie segmenter model"
```

---

## Task 2: The cutout tool (core helpers + client)

**Files:**
- Create: `packages/core/src/cutout.ts` + `packages/core/test/cutout.test.ts`
- Modify: `packages/core/package.json` (`"./cutout"` export)
- Create: `packages/web/app/cutout/page.tsx` + `packages/web/app/cutout/CutoutClient.tsx`

**Interfaces:**
- Consumes: `swapExt` from `@event-editor/core/names`; `@mediapipe/tasks-vision` (dynamic import in the browser); the wasm path `/mediapipe/wasm` and model path `/mediapipe/selfie_segmenter.tflite` from Task 1.
- Produces (core): `cutoutOutName(srcName: string): string` (→ `<base>-cutout.png`); `type BgFill = "transparent" | { color: string }`; `normalizeBgFill(raw: { mode?: string; color?: string }): BgFill`.

- [ ] **Step 1: Write the failing core test**

`packages/core/test/cutout.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { cutoutOutName, normalizeBgFill } from "../src/cutout.js";

describe("cutoutOutName", () => {
  it("swaps any extension to -cutout.png", () => {
    expect(cutoutOutName("IMG_1234.JPG")).toBe("IMG_1234-cutout.png");
    expect(cutoutOutName("headshot.heic")).toBe("headshot-cutout.png");
  });
  it("sanitises and handles no extension", () => {
    expect(cutoutOutName("my photo")).toBe("my_photo-cutout.png");
  });
});

describe("normalizeBgFill", () => {
  it("defaults to transparent", () => {
    expect(normalizeBgFill({})).toBe("transparent");
    expect(normalizeBgFill({ mode: "transparent" })).toBe("transparent");
  });
  it("maps white to #ffffff", () => {
    expect(normalizeBgFill({ mode: "white" })).toEqual({ color: "#ffffff" });
  });
  it("accepts a valid custom hex", () => {
    expect(normalizeBgFill({ mode: "custom", color: "#12ab34" })).toEqual({ color: "#12ab34" });
  });
  it("falls back to transparent on junk colour", () => {
    expect(normalizeBgFill({ mode: "custom", color: "red" })).toBe("transparent");
  });
});
```

- [ ] **Step 2: Run it, verify fail**

Run: `cd packages/core && npx vitest run test/cutout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `core/src/cutout.ts`**

```typescript
import { swapExt } from "./names.js";

export type BgFill = "transparent" | { color: string };

export function cutoutOutName(srcName: string): string {
  // Background removal always outputs PNG (alpha). Name it <base>-cutout.png.
  const withoutExt = srcName.replace(/\.[a-z0-9]{1,5}$/i, "");
  return swapExt(`${withoutExt}-cutout`, "png");
}

export function normalizeBgFill(raw: { mode?: string; color?: string }): BgFill {
  if (raw.mode === "white") return { color: "#ffffff" };
  if (raw.mode === "custom") {
    return typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color)
      ? { color: raw.color.toLowerCase() }
      : "transparent";
  }
  return "transparent";
}
```

- [ ] **Step 4: Add export, build, verify pass**

Add `"./cutout": "./dist/cutout.js"` to `packages/core/package.json` exports.
Run: `cd packages/core && npm run build && npx vitest run test/cutout.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the page**

`packages/web/app/cutout/page.tsx`:
```typescript
import { CutoutClient } from "./CutoutClient";

export default function CutoutPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Remove a background</h1>
      <CutoutClient />
    </div>
  );
}
```

- [ ] **Step 6: Implement the client**

`packages/web/app/cutout/CutoutClient.tsx` (`"use client"`). Read `packages/web/app/heic/HeicClient.tsx` (multi-file rows) and `packages/web/app/qr/QrClient.tsx` (client-only, dynamic import, object-URL cleanup) for the house patterns. Build:

- **State**: `fill` (`"transparent" | "white" | "custom"`, default transparent) + `customColor` (`#ffffff`); `rows: { key; file; name; status: "idle"|"loading"|"busy"|"done"|"error"; url?; filename?; error? }[]`; `modelReady` boolean.
- **Refs**: `rowsRef` synced via `useEffect(() => { rowsRef.current = rows }, [rows])`; unmount `useEffect(() => () => { for (const r of rowsRef.current) if (r.url) URL.revokeObjectURL(r.url) }, [])`. Also a `segmenterRef` holding the created `ImageSegmenter` (created once, reused).
- **File input**: `<input type="file" multiple accept="image/*">`; seed one `idle` row per file.
- **Fill control**: `Segmented` (`Transparent | White | Custom colour`); when `custom`, an `<input type="color">` bound to `customColor`. A helper line: "Best for photos of people."
- **getSegmenter()** (lazy, memoised on `segmenterRef`):
```typescript
async function getSegmenter() {
  if (segmenterRef.current) return segmenterRef.current;
  const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const seg = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "/mediapipe/selfie_segmenter.tflite" },
    runningMode: "IMAGE",
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  segmenterRef.current = seg;
  return seg;
}
```
  Verify the exact named exports (`FilesetResolver`, `ImageSegmenter`) and the options against the installed `@mediapipe/tasks-vision` version's types — adjust if the API differs.
- **Run** ("Remove backgrounds", `.btn.btn-accent`): loop rows **serially** (`for...of` + `await`). For each `idle`/`error` row:
  1. Set the row `loading` if `!modelReady`, else `busy`.
  2. `const seg = await getSegmenter(); setModelReady(true);`
  3. Decode: `const bitmap = await createImageBitmap(row.file);`
  4. `const result = seg.segment(bitmap);` then `const mask = result.confidenceMasks![0];` `const conf = mask.getAsFloat32Array();` `const w = mask.width, h = mask.height;` (verify the mask width/height match `bitmap.width/height`; if the segmenter returned a different size, draw the image scaled to `w×h`).
  5. Build the transparent cutout on a canvas `A` (`w×h`): `ctx.drawImage(bitmap, 0, 0, w, h)`, `const img = ctx.getImageData(0,0,w,h)`, then for each pixel `i`: `img.data[i*4+3] = Math.round(conf[i] * 255)` (confidence near 1 = person = opaque; near 0 = background = transparent). `ctx.putImageData(img, 0, 0)`.
  6. If `fill !== "transparent"`: canvas `B` (`w×h`), `ctxB.fillStyle = fillColor; ctxB.fillRect(0,0,w,h); ctxB.drawImage(A, 0, 0);` — export `B`. Else export `A`.
  7. `result.close();` (free the MediaPipe result). `const blob = await new Promise(r => canvas.toBlob(r, "image/png"));`
  8. `const url = URL.createObjectURL(blob);` set the row `done` with `{ url, filename: cutoutOutName(row.file.name) }` (import `cutoutOutName`/`normalizeBgFill` from `@event-editor/core/cutout`; resolve the fill colour once before the loop via `normalizeBgFill({ mode: fill, color: customColor })`).
  9. On throw, set the row `error` + a readable message; continue the loop.
- **Per-row UI**: filename + status; `loading` → `Loader2` + "Preparing the background remover…"; `busy` → `Loader2` + "Removing…"; `done` → result `<img src={row.url}>` on a **checkerboard backdrop** (a CSS checkerboard: a small `repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%)` background sized ~16px, behind the image) + `<a className="btn" href={row.url} download={row.filename}>`; `error` → `text-danger` + Retry (re-runs just that row).
- **Removing a row** revokes its `url` and drops it.
- No em dashes. No server fetch other than the same-origin `/mediapipe/*` static assets the browser loads via the library. No API route.

- [ ] **Step 7: Verify build + bundling**

Run: `cd packages/web && npx tsc --noEmit`
Expected: only the 5 pre-existing errors.
Run: `cd packages/web && npm run build`
Expected: succeeds (prebuild fetches assets first), lists `/cutout`, and `@mediapipe/tasks-vision` bundles into the client without a node-only-builtin error.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/cutout.ts packages/core/test/cutout.test.ts packages/core/package.json packages/web/app/cutout
git commit -m "feat(cutout): client-side MediaPipe background removal tool"
```

---

## Task 3: Register the cutout tool

**Files:**
- Modify: `packages/web/components/tools.ts`

- [ ] **Step 1: Add the icon import and entry**

Extend the `lucide-react` import in `tools.ts` with `Eraser` (verify it exists; if not, use `ImageOff` and note the swap). Append to `TOOLS`:
```typescript
  {
    id: "cutout",
    href: "/cutout",
    title: "Remove a background",
    body: "Cut a person out of a photo onto a transparent or solid background.",
    Icon: Eraser,
    defaultGroups: ["images"],
    tags: ["background", "remove", "cutout", "transparent", "png", "person", "photo"],
  },
```

- [ ] **Step 2: Verify tests + build**

Run:
```bash
cd packages/web && npx tsc --noEmit && npx vitest run && npm run build
```
Expected: tsc only the 5 pre-existing; vitest green (a registry test asserting the tool-id list / count needs `cutout` added to the expected ids — update it to include `cutout`, matching how Build #9's Task 8 handled additions; do NOT weaken any assertion); `next build` lists `/cutout` (now 12 tool routes).

- [ ] **Step 3: Live smoke (report as owed if headless)**

Run the app; confirm the `cutout` card appears in Images and search finds it by "background"/"cutout"; `/cutout` loads without a client error. A REAL removal (photo of a person → transparent PNG) needs a browser + a real image — if you cannot do that headless, report it as owed to Caleb.

- [ ] **Step 4: Commit**

```bash
git add packages/web/components/tools.ts packages/web/test
git commit -m "feat(cutout): register the background removal tool"
```

---

## Self-review notes (for the executor)

- **License re-confirm (Task 1 Step 1):** `@mediapipe/tasks-vision` should be Apache-2.0. If it isn't, stop — the switch's whole purpose was a permissive license.
- **Asset paths are load-bearing:** `FilesetResolver.forVisionTasks("/mediapipe/wasm")` and `modelAssetPath: "/mediapipe/selfie_segmenter.tflite"` must match exactly where Task 1 puts the files. If they don't resolve, the model silently fails at runtime while the build passes — the manual smoke is what proves it.
- **Mask orientation:** confidence near 1 = person (opaque), near 0 = background (transparent). If the cutout comes out inverted (background kept, person removed), flip to `255 - conf*255` — but verify against the selfie segmenter's actual output; do not guess in code, test with a real image in the smoke.
- **Mask vs image dimensions:** if `mask.width/height` differ from the bitmap, draw the image scaled to the mask size (or scale the mask) so pixel indices line up. Handle it, don't assume.
- **Object-URL cleanup:** ref-synced-to-rows pattern (splice lesson), not `[]`-deps over initial rows.
- **No native module, no job dir, no route** — any of those in the diff = over-build.
- **Person-only is expected**, not a bug — the copy says "Best for photos of people."
