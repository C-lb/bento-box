# Spec B Batch E — Background Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side "Remove a background" tool (`cutout`, `/cutout`) to the event-editor tool shell — drop photos, get transparent-PNG cutouts, all in the browser.

**Architecture:** Fully client-side, following the QR tool's shape. `@imgly/background-removal` runs a U^2-Net segmentation model in the browser via ONNX Runtime Web (WASM); the photo never leaves the machine. Model + WASM assets are self-hosted under `packages/web/public/imgly/` (copied from the `@imgly/background-removal-data` npm package at pre-build), so it works offline and ships in the packaged desktop app with NO native module. Pure helpers live in `packages/core/src/cutout.ts`; there is no API route, no `lib/` IO module, and no job dir.

**Tech Stack:** TypeScript, Next.js (client component), React, vitest. New deps: `@imgly/background-removal`, `@imgly/background-removal-data`.

## Global Constraints

- **Client-only tool.** NO `app/api/cutout/**`, NO `packages/web/lib/cutout.ts`, NO job dir. All processing runs in the browser. (An API route or job dir would be an over-build finding.)
- **Core subpath export:** add `"./cutout": "./dist/cutout.js"` to `packages/core/package.json` `exports`; after any `packages/core/src` change run `npm run build` in `packages/core` before the web app or its tests see it. Core test imports use the `.js` extension (`import { x } from "../src/cutout.js"`).
- **Model assets self-hosted:** `@imgly/background-removal` must be configured with `publicPath: "/imgly/"` (or the exact value Task 1 determines from the installed data package's dist layout) so it loads from the app's own origin, never the IMG.LY CDN.
- **SSR safety:** `CutoutClient` is `"use client"`; the `import("@imgly/background-removal")` happens INSIDE the run handler, never at module top level (WASM must not load during SSR/build).
- **Object-URL cleanup:** revoke result object URLs on row removal AND on unmount using a ref synced to the live rows (the splice-tool pattern) — NOT a `useEffect([])` cleanup closing over the initial empty rows array (that stale-closure leak was a real bug in the splice tool).
- **Serial processing:** process a batch one file at a time (WASM inference is memory-heavy), not `Promise.all`.
- **House UI:** anti-vibecode. Reuse `.card`, `.field`, `.btn`, `.btn-accent`, `.eyebrow`, `.text-muted`, `.text-danger`, `Segmented` (`@/components/Segmented`), `Loader2`. One accent per view (the primary "Remove backgrounds" button is `.btn-accent`). Sentence-case labels, NO em dashes in user-facing copy.
- **`packages/web` has 5 PRE-EXISTING `tsc --noEmit` errors** (test/docs.test.ts + test/canva-oauth.test.ts). "Clean" = NO NEW errors from this task's files.
- **Commits:** conventional, atomic. End every commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Push to `main` after each task (repo default).

## File Structure

- Task 1: `packages/web/scripts/copy-bg-assets.mjs` (create); `packages/web/package.json` (add `predev`/`prebuild`, deps); `.gitignore` (add `packages/web/public/imgly/`).
- Task 2: `packages/core/src/cutout.ts` + `packages/core/test/cutout.test.ts` (create); `packages/core/package.json` (export); `packages/web/app/cutout/page.tsx` + `packages/web/app/cutout/CutoutClient.tsx` (create).
- Task 3: `packages/web/components/tools.ts` (add one entry).

---

## Task 1: Model-asset infrastructure

**Files:**
- Create: `packages/web/scripts/copy-bg-assets.mjs`
- Modify: `packages/web/package.json` (deps + `predev`/`prebuild`)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `public/imgly/` populated with the `@imgly/background-removal-data` dist, present before `next dev`/`next build`. The exact `publicPath` value the client will use (determined from the real dist layout).

- [ ] **Step 1: Install the deps**

Run: `cd packages/web && npm install @imgly/background-removal @imgly/background-removal-data`
Expected: both added to `packages/web/package.json` dependencies.

- [ ] **Step 2: Inspect the data package's real dist layout**

Run: `cd packages/web && node -e "const p=require('@imgly/background-removal-data/package.json'); console.log(p.version)" && ls node_modules/@imgly/background-removal-data/dist | head -40`
Read the output. Note what the `dist/` contains (onnx model files, `.wasm`, a resources manifest/json). **This determines the copy target and the `publicPath` value used in Task 2.** Record the correct `publicPath` in your report (it is `/imgly/` if you copy `dist/*` directly into `public/imgly/`, but confirm the library expects the resources at that path root — check the library README / its `PublicPathConfig` type). Also verify the library's own license terms in `node_modules/@imgly/background-removal/package.json` (`license` field) and its LICENSE file; report what you find — if it requires a commercial license or attribution, STOP and report as a concern before proceeding (this is an open item in the spec).

- [ ] **Step 3: Write the copy script**

`packages/web/scripts/copy-bg-assets.mjs`:
```javascript
// Copy the @imgly/background-removal model + wasm assets into public/ so the
// browser loads them from our own origin (offline-capable, private) instead of
// the IMG.LY CDN. Runs on predev/prebuild. The dest is git-ignored — it's a
// copy of a dependency, not source.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// Resolve the installed data package's dist directory.
const dataPkg = require.resolve("@imgly/background-removal-data/package.json");
const srcDist = resolve(dirname(dataPkg), "dist");
const dest = resolve(here, "..", "public", "imgly");

if (!existsSync(srcDist)) {
  console.error(`[copy-bg-assets] source not found: ${srcDist} — is @imgly/background-removal-data installed?`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(srcDist, dest, { recursive: true });
console.log(`[copy-bg-assets] copied ${srcDist} -> ${dest}`);
```

Note: if Step 2 shows the dist has a nested versioned folder the library expects at a specific path, adjust `srcDist`/`dest` and the Task 2 `publicPath` to match — the goal is that `publicPath + <resource filename>` resolves to a real served file.

- [ ] **Step 4: Wire predev/prebuild + gitignore**

In `packages/web/package.json` `scripts`, add:
```json
"predev": "node scripts/copy-bg-assets.mjs",
"prebuild": "node scripts/copy-bg-assets.mjs"
```
(npm runs `predev` before `dev` and `prebuild` before `build` automatically, including when the root `dev`/`build` and the desktop assemble invoke `next build`.)

In `.gitignore`, add a line:
```
packages/web/public/imgly/
```

- [ ] **Step 5: Verify assets land and the app still builds**

Run: `cd packages/web && node scripts/copy-bg-assets.mjs && ls public/imgly | head`
Expected: the assets are copied (non-empty listing).
Run: `cd packages/web && npx tsc --noEmit`
Expected: only the 5 pre-existing errors (no new — this task adds no TS).

- [ ] **Step 6: Commit**

```bash
git add packages/web/scripts/copy-bg-assets.mjs packages/web/package.json packages/web/package-lock.json .gitignore
git commit -m "feat(cutout): self-host @imgly background-removal model assets"
```

---

## Task 2: The cutout tool (core helpers + client)

**Files:**
- Create: `packages/core/src/cutout.ts` + `packages/core/test/cutout.test.ts`
- Modify: `packages/core/package.json` (`"./cutout"` export)
- Create: `packages/web/app/cutout/page.tsx` + `packages/web/app/cutout/CutoutClient.tsx`

**Interfaces:**
- Consumes: `swapExt` from `@event-editor/core/names`; `@imgly/background-removal` (dynamic import in the browser); `publicPath` from Task 1.
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
  const withSuffix = srcName.replace(/(\.[a-z0-9]{1,5})?$/i, "-cutout");
  return swapExt(withSuffix, "png");
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

Note: verify `cutoutOutName("my photo")` yields `my_photo-cutout.png` — `swapExt` runs `safeBase` which turns the space into `_`. If the regex-replace approach mis-handles a case in the test, prefer stripping the extension first (`srcName.replace(/\.[a-z0-9]{1,5}$/i, "")`) then appending `-cutout` then `swapExt(x, "png")`; make the tests pass.

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

`packages/web/app/cutout/CutoutClient.tsx` (`"use client"`). Read `packages/web/app/heic/HeicClient.tsx` (multi-file rows + per-row status/download/retry) and `packages/web/app/qr/QrClient.tsx` (client-only, dynamic import, object-URL cleanup) for the house patterns, then build:

- **State**: `fill` mode (`"transparent" | "white" | "custom"`, default transparent) + `customColor` (default `#ffffff`); `rows: { key; file; name; status: "idle"|"preparing"|"busy"|"done"|"error"; url?; filename?; error? }[]`; a `modelReady` boolean (false until the first successful run) so later runs don't show the "preparing" copy.
- **Refs**: `rowsRef` synced to `rows` via `useEffect(() => { rowsRef.current = rows }, [rows])`; on unmount, `useEffect(() => () => { for (const r of rowsRef.current) if (r.url) URL.revokeObjectURL(r.url) }, [])`.
- **File input**: `<input type="file" multiple accept="image/*">`; on change seed one `idle` row per file.
- **Fill control**: a `Segmented` (`Transparent | White | Custom colour`); when `custom`, show an `<input type="color">` bound to `customColor`.
- **Run** ("Remove backgrounds", `.btn.btn-accent`): build the fill from `normalizeBgFill({ mode: fill, color: customColor })` (import from `@event-editor/core/cutout`), then loop rows **serially** (a `for...of` with `await`, not `Promise.all`). For each `idle`/`error` row:
  1. Set the row `preparing` if `!modelReady`, else `busy`.
  2. `const { removeBackground } = await import("@imgly/background-removal");` (dynamic import — verify the exact named export against the installed version in Task 1's notes; it may be a default export).
  3. `const blob = await removeBackground(row.file, { publicPath: "<value from Task 1>", output: { format: "image/png" }, progress: (key, cur, total) => { /* optional: while key starts with "fetch"/"compile" the model is still loading; you can reflect it on the row */ } });`
  4. If `fill !== "transparent"`, composite: draw the cutout blob onto a `<canvas>` filled with the fill colour, then `canvas.toBlob(..., "image/png")`. (Load the blob into an `Image` via an object URL, size the canvas to the image, `ctx.fillStyle = color; ctx.fillRect(...)`, `ctx.drawImage(img, 0, 0)`, export.) Revoke the temp image URL.
  5. `const url = URL.createObjectURL(finalBlob);` set the row `done` with `{ url, filename: cutoutOutName(row.file.name) }`. Set `modelReady = true`.
  6. On throw, set the row `error` with a readable message; continue the loop.
- **Per-row UI**: original filename + status; while `preparing`, `Loader2` + "Preparing the background remover…"; while `busy`, `Loader2` + "Removing…"; when `done`, a result preview `<img src={row.url}>` on a **checkerboard backdrop** (a small CSS checkerboard via a `conic-gradient`/`repeating` background on the preview box, or a bundled inline style) so transparency reads, plus a download `<a className="btn" href={row.url} download={row.filename}>`; when `error`, `text-danger` message + a Retry button that re-runs just that row.
- **Removing a row** revokes its `url` and drops it from `rows`.
- No em dashes in any copy. No fetch to any server. No API route.

- [ ] **Step 7: Verify build + bundling**

Run: `cd packages/web && npx tsc --noEmit`
Expected: only the 5 pre-existing errors.
Run: `cd packages/web && npm run build`
Expected: succeeds (prebuild copies the assets first), lists `/cutout` as a route, and `@imgly/background-removal` bundles into the client without a node-only-builtin error. If the build fails on a node built-in pulled by the library, note it — the library should have a browser build; confirm the import path/entry is the browser one.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/cutout.ts packages/core/test/cutout.test.ts packages/core/package.json packages/web/app/cutout
git commit -m "feat(cutout): client-side background removal tool"
```

---

## Task 3: Register the cutout tool

**Files:**
- Modify: `packages/web/components/tools.ts`

**Interfaces:**
- Consumes: the `Tool` type already in `tools.ts`.

- [ ] **Step 1: Add the icon import and entry**

Extend the `lucide-react` import in `tools.ts` with `Eraser` (verify it exists in the installed `lucide-react`; if not, use `ImageOff` or `Scissors`-adjacent and note the swap). Append to `TOOLS`:
```typescript
  {
    id: "cutout",
    href: "/cutout",
    title: "Remove a background",
    body: "Cut the subject out of a photo onto a transparent or solid background.",
    Icon: Eraser,
    defaultGroups: ["images"],
    tags: ["background", "remove", "cutout", "transparent", "png", "photo"],
  },
```

- [ ] **Step 2: Verify tests + build**

Run:
```bash
cd packages/web && npx tsc --noEmit && npx vitest run && npm run build
```
Expected: tsc only the 5 pre-existing; vitest green (a registry test asserting the tool-id list / count will need `cutout` added — update it to include `cutout` in the expected ids, matching how Build #9's Task 8 handled the 6-tool additions; do NOT weaken any assertion); `next build` lists `/cutout` among the routes (now 12 tool routes).

- [ ] **Step 3: Live smoke (report as owed to the controller/Caleb if headless)**

Run the app; on the home grid confirm the `cutout` card appears in the Images group and search finds it by "background"/"cutout". Open `/cutout` and confirm it loads without a client error. A REAL removal (drop a photo → transparent PNG) needs a browser + a real image — if you cannot do that headless, report it as owed.

- [ ] **Step 4: Commit**

```bash
git add packages/web/components/tools.ts packages/web/test
git commit -m "feat(cutout): register the background removal tool"
```

---

## Self-review notes (for the executor)

- **License gate (Task 1 Step 2):** the one thing that can sink this tool is `@imgly/background-removal`'s license. Check it early and report before building the client — if it needs a commercial license, stop and escalate.
- **publicPath is the load-bearing config:** if `publicPath` doesn't resolve to the copied assets, the model silently fails to load at runtime (the build passes). Task 1 must determine the correct value from the real dist layout, and Task 2 must use exactly that value. The manual smoke is what proves it.
- **Object-URL cleanup:** use the ref-synced-to-rows pattern from the splice tool, not a `[]`-deps cleanup over the initial rows — that exact stale-closure leak was a caught bug.
- **No native module, no job dir, no route** — if any appear in the diff, that's over-build.
- **Desktop app:** the assets ship via `public/` in the standalone output; confirm during a later desktop rebuild that `/imgly/` resolves in the packaged app (not this plan's scope, but note it).
