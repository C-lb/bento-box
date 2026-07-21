# Confidentiality Stamp Preview Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user preview and adjust the slicer's confidentiality watermark (rotation, size, opacity) live against a real page before exporting, instead of exporting a fixed, unseen stamp.

**Architecture:** Parameterize the existing `watermarkPdf` with optional rotation/size/opacity (defaulting to today's hardcoded values). Add a clamping helper so out-of-range input can't produce a broken or invisible stamp. Add a GET route that stamps a single page on demand and rasterizes it (reusing spec 2's `renderPdfPages`) to a PNG the browser can show directly in an `<img>`. Wire three sliders + a page stepper into the slicer UI, debounced so dragging doesn't spam the server, and thread the chosen values through to the real export so what's previewed is what ships.

**Tech Stack:** TypeScript, Next.js (App Router) API routes, `pdf-lib` for stamping, `pdfjs-dist`/`@napi-rs/canvas` (via the existing `renderPdfPages` helper) for rasterization, React state + `useEffect`/`setTimeout` for debouncing, Vitest for tests.

## Global Constraints

- Omitting the new rotation/size/opacity options from `watermarkPdf` must reproduce today's exact stamp (45° / 1.0x / 0.22 opacity) — no behavior change for existing callers.
- Rotation clamps to [-90, 90] degrees, size scale to [0.5, 1.5], opacity to [0.05, 0.6] — applied server-side in the preview route (and reused by the export path) so malformed input can't produce a broken/invisible stamp.
- The preview route returns a raw PNG image response (`content-type: image/png`), not JSON — it's consumed directly as an `<img src>`.
- No new npm dependencies.
- Follow existing test conventions: Vitest, tests in `packages/web/test/*.test.ts`.

---

### Task 1: Parameterize `watermarkPdf` and `buildOutputs`

**Files:**
- Modify: `packages/web/lib/pdf-slice.ts`
- Test: `packages/web/test/pdf-slice.test.ts`

**Interfaces:**
- Produces: `watermarkPdf(bytes: Uint8Array, text: string, opts?: { rotationDeg?: number; sizeScale?: number; opacity?: number }): Promise<Uint8Array>`. `clampStampOpts(opts?: { rotationDeg?: number; sizeScale?: number; opacity?: number }): { rotationDeg: number; sizeScale: number; opacity: number }` — pure function, clamps each field to its range and fills in defaults (45 / 1 / 0.22) for missing fields. `buildOutputs`'s `opts` type gains the same three optional fields, passed through to its `watermarkPdf` call. Task 2 imports `clampStampOpts`; Task 3's export flow relies on `buildOutputs` accepting these fields.

- [ ] **Step 1: Write the failing tests**

Add to `packages/web/test/pdf-slice.test.ts` (extend the existing `describe("pdf-slice", ...)` block — add these `it`s and update the import line):

```ts
import { pdfPageCount, extractPages, watermarkPdf, buildOutputs, clampStampOpts } from "../lib/pdf-slice";
```

```ts
  it("clamps stamp options to safe ranges and fills in defaults", () => {
    expect(clampStampOpts()).toEqual({ rotationDeg: 45, sizeScale: 1, opacity: 0.22 });
    expect(clampStampOpts({ rotationDeg: 999, sizeScale: 999, opacity: 999 })).toEqual({ rotationDeg: 90, sizeScale: 1.5, opacity: 0.6 });
    expect(clampStampOpts({ rotationDeg: -999, sizeScale: -999, opacity: -999 })).toEqual({ rotationDeg: -90, sizeScale: 0.5, opacity: 0.05 });
    expect(clampStampOpts({ rotationDeg: 10, sizeScale: 0.8, opacity: 0.4 })).toEqual({ rotationDeg: 10, sizeScale: 0.8, opacity: 0.4 });
  });

  it("watermarkPdf accepts custom rotation/size/opacity and stays a valid PDF", async () => {
    const out = await watermarkPdf(await makePdf(2), "SECRET", { rotationDeg: 10, sizeScale: 0.6, opacity: 0.5 });
    expect(await pdfPageCount(out)).toBe(2);
  });

  it("watermarkPdf with no opts matches the default-opts stamp exactly", async () => {
    const src = await makePdf(1);
    const a = await watermarkPdf(src, "SECRET");
    const b = await watermarkPdf(src, "SECRET", { rotationDeg: 45, sizeScale: 1, opacity: 0.22 });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("buildOutputs passes stamp options through to watermarkPdf", async () => {
    const master = await makePdf(2);
    const groups = [{ label: "Intro", filename: "Intro.pdf", pages: [1, 2] }];
    const custom = await buildOutputs(master, groups, {
      confidential: true, watermarkText: "SECRET", rotationDeg: 0, sizeScale: 0.5, opacity: 0.6,
    });
    const defaultOpts = await buildOutputs(master, groups, { confidential: true, watermarkText: "SECRET" });
    // Different stamp geometry/opacity produce different bytes for the same page count.
    expect(await pdfPageCount(custom[0].bytes)).toBe(2);
    expect(Buffer.from(custom[0].bytes).equals(Buffer.from(defaultOpts[0].bytes))).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && npx vitest run test/pdf-slice.test.ts`
Expected: FAIL — `clampStampOpts` doesn't exist; `watermarkPdf` doesn't accept a third argument yet (TS may also flag this depending on strictness, but the runtime assertions will fail regardless).

- [ ] **Step 3: Implement**

In `packages/web/lib/pdf-slice.ts`, add the clamp helper and update `watermarkPdf` and `buildOutputs`:

```ts
export interface StampOpts { rotationDeg?: number; sizeScale?: number; opacity?: number }

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Fill in defaults (45deg / 1x / 0.22) and clamp to safe ranges. */
export function clampStampOpts(opts?: StampOpts): { rotationDeg: number; sizeScale: number; opacity: number } {
  return {
    rotationDeg: clamp(opts?.rotationDeg ?? 45, -90, 90),
    sizeScale: clamp(opts?.sizeScale ?? 1, 0.5, 1.5),
    opacity: clamp(opts?.opacity ?? 0.22, 0.05, 0.6),
  };
}

/** Stamp a large diagonal, semi-transparent grey watermark on every page. */
export async function watermarkPdf(bytes: Uint8Array, text: string, opts?: StampOpts): Promise<Uint8Array> {
  const { rotationDeg, sizeScale, opacity } = clampStampOpts(opts);
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const label = text.trim() || "CONFIDENTIAL";
  const angle = (rotationDeg * Math.PI) / 180;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    // Scale the font so the stamp runs most of the way across the page diagonal.
    const target = Math.hypot(width, height) * 0.9 * sizeScale;
    const probe = font.widthOfTextAtSize(label, 100);
    const size = (100 * target) / probe;
    const textWidth = font.widthOfTextAtSize(label, size);
    const x = width / 2 - (Math.cos(angle) * textWidth) / 2;
    const y = height / 2 - (Math.sin(angle) * textWidth) / 2;
    page.drawText(label, { x, y, size, font, color: rgb(0.6, 0.6, 0.6), rotate: degrees(rotationDeg), opacity });
  }
  return doc.save();
}

/** Build one PDF (or HTML) per planned group, watermarking when confidential. */
export async function buildOutputs(
  masterBytes: Uint8Array,
  groups: PlannedGroup[],
  opts: { confidential: boolean; watermarkText: string; format?: "pdf" | "html" } & StampOpts,
): Promise<OutputFile[]> {
  const format = opts.format ?? "pdf";
  const out: OutputFile[] = [];
  for (const g of groups) {
    let bytes = await extractPages(masterBytes, g.pages);
    if (opts.confidential) {
      bytes = await watermarkPdf(bytes, opts.watermarkText, {
        rotationDeg: opts.rotationDeg, sizeScale: opts.sizeScale, opacity: opts.opacity,
      });
    }
    if (format === "html") {
      const pages = await renderPdfPages(Buffer.from(bytes));
      const html = pagesToHtml(pages, g.label);
      out.push({ label: g.label, filename: swapExt(g.filename, "html"), bytes: html });
      continue;
    }
    out.push({ label: g.label, filename: g.filename, bytes });
  }
  return out;
}
```

Note: the "watermarkPdf with no opts matches the default-opts stamp exactly" test relies on `PDFDocument.save()` being deterministic for identical input+operations — pdf-lib's save output is deterministic for the same document mutations in the same order, which holds here since both calls perform the identical sequence of operations.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run test/pdf-slice.test.ts`
Expected: PASS — all 9 tests green (4 pre-existing + 1 html + 4 new from this task... recount: original file had 6 tests before this task's additions per the brief's current-state description — verify actual count matches after edits, don't hardcode an assumed number in your own verification, just confirm 0 failures).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/pdf-slice.ts packages/web/test/pdf-slice.test.ts
git commit -m "feat: add editable rotation/size/opacity to slicer watermark"
```

---

### Task 2: Live stamp-preview API route

**Files:**
- Create: `packages/web/app/api/slice/[runId]/stamp-preview/route.ts`
- Test: `packages/web/test/stamp-preview-route.test.ts`

**Interfaces:**
- Consumes: `clampStampOpts`, `watermarkPdf`, `extractPages`, `pdfPageCount` (all from `@/lib/pdf-slice`, Task 1), `renderPdfPages` (from `@/lib/convert-file`, already exists from spec 2), `masterPdfPath` (from `@/lib/slice`, already exists).
- Produces: `GET` handler at this route path. No other task depends on this route's internals — Task 3 calls it only via URL string construction in the browser.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/stamp-preview-route.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";

const tmp = mkdtempSync(resolve(tmpdir(), "stamp-preview-"));
process.env.EE_DATA_DIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

import { GET } from "@/app/api/slice/[runId]/stamp-preview/route";
import { masterPdfPath, runDir } from "@/lib/slice";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 200]);
  return doc.save();
}

function req(runId: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new Request(`http://x/api/slice/${runId}/stamp-preview?${qs}`);
}

describe("stamp-preview route", () => {
  it("returns a PNG image for a valid page", async () => {
    const runId = "run1";
    mkdirSync(runDir(runId), { recursive: true });
    writeFileSync(masterPdfPath(runId), Buffer.from(await makePdf(3)));
    const res = await GET(req(runId, { page: "2", text: "SECRET" }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }, 30000);

  it("400s on an out-of-range page number", async () => {
    const runId = "run2";
    mkdirSync(runDir(runId), { recursive: true });
    writeFileSync(masterPdfPath(runId), Buffer.from(await makePdf(2)));
    const res = await GET(req(runId, { page: "5", text: "SECRET" }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(400);
  });

  it("400s when page is missing or not a number", async () => {
    const runId = "run3";
    mkdirSync(runDir(runId), { recursive: true });
    writeFileSync(masterPdfPath(runId), Buffer.from(await makePdf(2)));
    const res = await GET(req(runId, { text: "SECRET" }), { params: Promise.resolve({ runId }) });
    expect(res.status).toBe(400);
  });

  it("404s when the run doesn't exist", async () => {
    const res = await GET(req("does-not-exist", { page: "1" }), { params: Promise.resolve({ runId: "does-not-exist" }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/stamp-preview-route.test.ts`
Expected: FAIL — module `@/app/api/slice/[runId]/stamp-preview/route` doesn't exist.

- [ ] **Step 3: Implement**

Create `packages/web/app/api/slice/[runId]/stamp-preview/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { masterPdfPath } from "@/lib/slice";
import { pdfPageCount, extractPages, watermarkPdf, clampStampOpts } from "@/lib/pdf-slice";
import { renderPdfPages } from "@/lib/convert-file";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const url = new URL(request.url);
  const pageParam = url.searchParams.get("page");
  const page = pageParam ? Number(pageParam) : NaN;
  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: "page must be a positive integer" }, { status: 400 });
  }

  let master: Buffer;
  try {
    master = await readFile(masterPdfPath(runId));
  } catch {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const pageCount = await pdfPageCount(master);
  if (page > pageCount) {
    return NextResponse.json({ error: `page must be between 1 and ${pageCount}` }, { status: 400 });
  }

  const text = url.searchParams.get("text") ?? "CONFIDENTIAL";
  const opts = clampStampOpts({
    rotationDeg: numOrUndefined(url.searchParams.get("rotationDeg")),
    sizeScale: numOrUndefined(url.searchParams.get("sizeScale")),
    opacity: numOrUndefined(url.searchParams.get("opacity")),
  });

  const single = await extractPages(master, [page]);
  const stamped = await watermarkPdf(single, text, opts);
  const [png] = await renderPdfPages(Buffer.from(stamped));

  return new NextResponse(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}

function numOrUndefined(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run test/stamp-preview-route.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/api/slice/[runId]/stamp-preview/route.ts packages/web/test/stamp-preview-route.test.ts
git commit -m "feat: add live stamp-preview API route for the slicer"
```

---

### Task 3: SliceClient preview UI + export wiring

**Files:**
- Modify: `packages/web/app/slice/SliceClient.tsx`
- Modify: `packages/web/app/api/slice/export/route.ts`
- Test: manual (Playwright/dev-server visual check — no existing automated UI test harness for this component; covered by Task 1/2's unit tests for the underlying logic)

**Interfaces:**
- Consumes: the stamp-preview route (Task 2) via URL construction; `buildOutputs`'s new `StampOpts` fields (Task 1) via the export route.
- Produces: no new exports — this is the UI/route wiring layer.

- [ ] **Step 1: Add stamp-control state to `SliceClient.tsx`**

Add state near the existing `confidential`/`watermark`/`format` state (around line 33-35):

```tsx
const [confidential, setConfidential] = useState(false);
const [watermark, setWatermark] = useState("CONFIDENTIAL");
const [format, setFormat] = useState<"pdf" | "html">("pdf");
const [previewPage, setPreviewPage] = useState(1);
const [rotationDeg, setRotationDeg] = useState(45);
const [sizeScale, setSizeScale] = useState(1);
const [opacity, setOpacity] = useState(0.22);
const [previewSrc, setPreviewSrc] = useState<string | null>(null);
const [previewLoading, setPreviewLoading] = useState(false);
```

- [ ] **Step 2: Add the debounced preview-fetch effect**

Add this `useEffect` in the component body (needs `useEffect` added to the existing `import { useRef, useState } from "react";` — change to `import { useEffect, useRef, useState } from "react";`):

```tsx
  useEffect(() => {
    if (!runId || !confidential) { setPreviewSrc(null); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(previewPage),
          text: watermark,
          rotationDeg: String(rotationDeg),
          sizeScale: String(sizeScale),
          opacity: String(opacity),
        });
        const res = await fetch(`/api/slice/${runId}/stamp-preview?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Preview failed");
        const blob = await res.blob();
        setPreviewSrc((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setPreviewLoading(false);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, confidential, previewPage, watermark, rotationDeg, sizeScale, opacity]);
```

- [ ] **Step 3: Include the new fields in `exportPdfs()`'s POST body**

Modify the `exportPdfs` body (around line 107):

```tsx
        body: JSON.stringify({ runId, groups: rows, confidential, watermarkText: watermark, format, rotationDeg, sizeScale, opacity }),
```

- [ ] **Step 4: Reset the new state in `reset()`**

Modify `reset()` (around line 196):

```tsx
    setMode("manual"); setConfidential(false); setWatermark("CONFIDENTIAL"); setDriveFolder(""); setFormat("pdf");
    setPreviewPage(1); setRotationDeg(45); setSizeScale(1); setOpacity(0.22);
    if (previewSrc) URL.revokeObjectURL(previewSrc);
    setPreviewSrc(null);
```

- [ ] **Step 5: Add the controls + preview to the "3. Confidential watermark" card**

Replace the card body (around lines 315-326):

```tsx
          {/* Confidential */}
          <div className="card">
            <p className="eyebrow">3. Confidential watermark</p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} className="h-5 w-5 sm:h-4 sm:w-4" />
              Stamp every page with a confidential watermark
            </label>
            {confidential && (
              <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,320px)_1fr]">
                <div className="space-y-3">
                  <label className="block text-sm font-medium">Watermark text
                    <input className="field mt-1 w-full min-h-[44px] sm:min-h-0" value={watermark} onChange={(e) => setWatermark(e.target.value)} />
                  </label>
                  <label className="block text-sm font-medium">Preview page
                    <input
                      type="number" min={1} max={pageCount || 1} value={previewPage}
                      onChange={(e) => setPreviewPage(Math.min(Math.max(1, Number(e.target.value) || 1), pageCount || 1))}
                      className="field mt-1 w-24 min-h-[44px] sm:min-h-0"
                    />
                  </label>
                  <label className="block text-sm font-medium">Rotation ({rotationDeg}°)
                    <input type="range" min={-90} max={90} value={rotationDeg} onChange={(e) => setRotationDeg(Number(e.target.value))} className="mt-1 w-full" />
                  </label>
                  <label className="block text-sm font-medium">Size ({Math.round(sizeScale * 100)}%)
                    <input type="range" min={0.5} max={1.5} step={0.05} value={sizeScale} onChange={(e) => setSizeScale(Number(e.target.value))} className="mt-1 w-full" />
                  </label>
                  <label className="block text-sm font-medium">Opacity ({Math.round(opacity * 100)}%)
                    <input type="range" min={0.05} max={0.6} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="mt-1 w-full" />
                  </label>
                </div>
                <div className="relative flex min-h-[220px] items-center justify-center rounded-lg border border-line bg-[#f4f4f5] p-2">
                  {previewSrc
                    ? <img src={previewSrc} alt="Watermark preview" className="max-h-[320px] w-auto" />
                    : <span className="text-sm text-muted">{previewLoading ? "Loading preview…" : "Preview will appear here"}</span>}
                  {previewLoading && previewSrc && (
                    <span className="absolute right-2 top-2 rounded-full bg-white/80 px-2 py-0.5 text-xs text-muted shadow-soft">Updating…</span>
                  )}
                </div>
              </div>
            )}
          </div>
```

Note: the `°` in the JSX label text is the degree sign (°) — write it as the literal character in the file, not the escape sequence (the escape is shown here only because this plan document renders through Markdown).

- [ ] **Step 6: Pass the stamp options through the export route**

Modify `packages/web/app/api/slice/export/route.ts`'s request body type and the `buildOutputs` call:

```ts
    const { runId, groups, confidential, watermarkText, format, rotationDeg, sizeScale, opacity } = (await request.json()) as {
      runId: string;
      groups: GroupInput[];
      confidential: boolean;
      watermarkText?: string;
      format?: "pdf" | "html";
      rotationDeg?: number;
      sizeScale?: number;
      opacity?: number;
    };
```

```ts
    const outputs = await buildOutputs(master, plan.groups, {
      confidential: !!confidential,
      watermarkText: watermarkText ?? "CONFIDENTIAL",
      format: format === "html" ? "html" : "pdf",
      rotationDeg, sizeScale, opacity,
    });
```

(`buildOutputs` clamps/defaults these internally via `clampStampOpts` inside `watermarkPdf`, so passing `undefined` through when the client omits them — which it won't, since the client always sends its current slider state — is safe either way.)

- [ ] **Step 7: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "SliceClient\|slice/export"`
Expected: no output (no new type errors introduced by this task's files).

- [ ] **Step 8: Manual verification with the dev server**

Note: PDF rasterization (used by the preview route) has a known Turbopack-dev-mode issue on some machines unrelated to this feature (see spec 2's shipped notes) — if the preview 500s with a "fake worker" error, that's the pre-existing environment issue, not a defect in this task; verify what you can (UI layout, slider interaction, debounce timing via network tab) and note the rasterization failure separately rather than treating it as a task bug.

Run: `cd packages/web && npm run dev` (background), then in a browser:
1. Navigate to `/slice`, upload a small multi-page PDF or pptx, plan a portion.
2. Check the confidentiality checkbox — confirm the watermark-text field, preview-page stepper, three sliders, and an empty/loading preview box appear.
3. Drag the rotation slider — confirm the preview image updates (or, if blocked by the known pdfjs/Turbopack issue, confirm a network request fires ~300ms after you stop dragging, visible in devtools).
4. Change the preview-page number — confirm it's clamped to `1..pageCount`.
5. Export with PDF format — confirm the exported file's stamp reflects the last-set rotation/size/opacity (open the downloaded PDF and compare against the last preview image, if rasterization was working; otherwise confirm the file downloads without error).
6. Click "Start over" — confirm all stamp controls reset to their defaults (45° / 100% / 22%).

Kill the dev server after verification: `pkill -f "next dev --port 3000"`.

- [ ] **Step 9: Commit**

```bash
git add packages/web/app/slice/SliceClient.tsx packages/web/app/api/slice/export/route.ts
git commit -m "feat: add live stamp preview controls to the slicer UI"
```

---

## Verification (full suite)

- [ ] Run the full web test suite: `cd packages/web && npx vitest run` — expect all tests green.
- [ ] Run the core package test suite: `cd packages/core && npx vitest run` — expect all tests green (this plan doesn't touch core, so this is a regression check).
- [ ] Confirm `watermarkPdf`'s default behavior is unchanged: the "matches the default-opts stamp exactly" test in Task 1 is the direct check; also re-confirm the pre-existing "keeps page count when watermarking" and "builds one output per group" tests from before this plan still pass unmodified.
