# Convert Multi-Format File Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broaden the `/convert` tool from audio-only into a general single-file converter (images ↔ png/jpg/webp/pdf, pdf → images, audio/video → mp3/wav/m4a) with an output-format dropdown, keeping the existing YouTube-link → mp3 flow intact.

**Architecture:** A pure core catalog decides which inputs convert to which outputs. Per-engine converters (sharp, pdf-lib, heic-convert, pdfjs+@napi-rs/canvas, ffmpeg) each do one conversion. A dispatcher routes (input, output) to the right engine and writes `out.<ext>` into the existing convert job dir. The `/api/convert/file` route gains an `output` field and stays backward-compatible (defaults to mp3). The client derives the output dropdown from the uploaded file's category.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, sharp, pdf-lib, heic-convert, ffmpeg-static, pdfjs-dist, @napi-rs/canvas, Electron (desktop packaging).

## Global Constraints

- Test runner: from `packages/web` and `packages/core`, `npx vitest run <path>`. Pure tests live in `packages/core/src/*.test.ts` (core) and `packages/web/test/` or beside the file (web).
- Core imports use subpath form: `@event-editor/core/<module>`. After changing `packages/core`, rebuild it (`npm run -w @event-editor/core build`) before the web package consumes new exports.
- `@napi-rs/canvas` is prebuilt N-API (ABI-stable, like sharp): it is NOT rebuilt via @electron/rebuild. It ships via `serverExternalPackages` + an explicit copy in `assemble-server.mjs` + the `module._load` externals shim. The repo uses NO `asarUnpack`.
- Single-file only (no batch rows). Fixed lossy quality 82 (no quality slider; the `resize` tool owns sizing/quality).
- House style: reuse the `Segmented` component for the output picker. Sentence-case copy, no em dashes. Reuse existing loading/error/success patterns in `ConvertClient`.
- Preserve the existing link → mp3 path byte-for-byte; only extend.

---

### Task 1: Add dependencies and desktop packaging wiring

**Files:**
- Modify: `packages/web/package.json` (deps)
- Modify: `packages/web/next.config.ts` (`serverExternalPackages`)
- Modify: `packages/desktop/scripts/assemble-server.mjs` (copy + shim)
- Modify: `packages/desktop/scripts/rebuild-native.mjs` (VERIFY dlopen)

**Interfaces:**
- Produces: `pdfjs-dist` and `@napi-rs/canvas` importable in `packages/web`; both shipped in the packaged desktop server tree.

- [ ] **Step 1: Install the two deps in the web workspace**

Run: `cd /Users/caleb/event-editor && npm install -w @event-editor/web pdfjs-dist@^4 @napi-rs/canvas@^0.1`
Expected: both added to `packages/web/package.json` dependencies; lockfile updated.

- [ ] **Step 2: Externalize @napi-rs/canvas in Next config**

In `packages/web/next.config.ts`, find the `serverExternalPackages` array (currently `["better-sqlite3", "sharp", "@anthropic-ai/sdk", "ffmpeg-static", "ffprobe-static"]`) and add `"@napi-rs/canvas"`:

```ts
serverExternalPackages: ["better-sqlite3", "sharp", "@anthropic-ai/sdk", "ffmpeg-static", "ffprobe-static", "@napi-rs/canvas"],
```

(Do not add `pdfjs-dist` — it is pure JS and should be bundled normally.)

- [ ] **Step 3: Copy @napi-rs/canvas into the assembled server**

In `packages/desktop/scripts/assemble-server.mjs`, locate the block that copies `sharp` and its `@img/*` platform packages into `build/server/node_modules` (search for `sharp`). Add an analogous copy for `@napi-rs/canvas` and its platform package. Concretely, after the sharp copy block add:

```js
// @napi-rs/canvas: prebuilt N-API canvas used by the PDF→image converter.
// Ship the main package plus the current platform's prebuilt binary package.
for (const pkg of ["@napi-rs/canvas", ...napiCanvasPlatformPkgs()]) {
  const from = resolve(repoRoot, "node_modules", pkg);
  if (existsSync(from)) {
    cpSync(from, resolve(serverModules, pkg), { recursive: true });
  }
}
```

and add this helper near the other helpers in the file:

```js
// The @napi-rs/canvas-<platform> package that holds the prebuilt .node for this
// build machine (e.g. @napi-rs/canvas-darwin-arm64). Enumerate what's installed
// rather than hardcoding, so a mac/win build each copies its own binary.
function napiCanvasPlatformPkgs() {
  const scope = resolve(repoRoot, "node_modules", "@napi-rs");
  if (!existsSync(scope)) return [];
  return readdirSync(scope)
    .filter((n) => n.startsWith("canvas-"))
    .map((n) => `@napi-rs/${n}`);
}
```

Ensure `readdirSync` is imported from `node:fs` at the top of the file alongside the existing fs imports (add it if missing).

- [ ] **Step 4: Add @napi-rs/canvas to the runtime require shim**

In the same file, find the injected `module._load` shim's `externals` array (search for the list containing `"better-sqlite3"`, `"sharp"`). Add `"@napi-rs/canvas"` to it so runtime `require("@napi-rs/canvas")` resolves to the bundled copy:

```js
const externals = ["better-sqlite3", "sharp", "@anthropic-ai/sdk", "ffmpeg-static", "ffprobe-static", "@napi-rs/canvas"];
```

(Match the exact existing variable/array; add only the one string.)

- [ ] **Step 5: Add a load-check for @napi-rs/canvas (optional but recommended)**

In `packages/desktop/scripts/rebuild-native.mjs`, find the `VERIFY` list (modules dlopen-checked under Electron). Add `"@napi-rs/canvas"` to `VERIFY` only (NOT to the `REBUILD`/`onlyModules` list). If adding it causes the verify step to fail because the package isn't in `build/server` yet at that point, leave this step out and rely on the Task 9 packaged smoke instead — note which you did in the report.

- [ ] **Step 6: Confirm imports resolve and web still builds**

Run: `cd packages/web && node -e "require('pdfjs-dist/legacy/build/pdf.mjs') ? 0 : 0" 2>/dev/null; npx tsc --noEmit`
Then: `npm run build`
Expected: build succeeds; no new tsc errors. (No runtime test here; the engines that use these deps are Tasks 5.)

- [ ] **Step 7: Commit**

```bash
git add packages/web/package.json package-lock.json packages/web/next.config.ts packages/desktop/scripts/assemble-server.mjs packages/desktop/scripts/rebuild-native.mjs
git commit -m "build(convert): add pdfjs-dist + @napi-rs/canvas and desktop packaging wiring"
```

---

### Task 2: Format catalog (pure core)

**Files:**
- Create: `packages/core/src/convert-formats.ts`
- Test: `packages/core/src/convert-formats.test.ts`

**Interfaces:**
- Produces (all pure, no I/O):
  - `type ConvertCategory = "image" | "heic" | "pdf" | "audio"`
  - `type OutputFormat = "png" | "jpg" | "webp" | "pdf" | "mp3" | "wav" | "m4a"`
  - `categoryForFile(filename: string): ConvertCategory | null`
  - `outputsFor(category: ConvertCategory): OutputFormat[]`
  - `isValidConversion(filename: string, output: OutputFormat): boolean`
  - `extFor(output: OutputFormat): string`
  - `convertOutName(srcName: string, output: OutputFormat, zip: boolean): string`
  - `isAudioOutput(output: OutputFormat): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/convert-formats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  categoryForFile, outputsFor, isValidConversion, extFor, convertOutName, isAudioOutput,
} from "./convert-formats";

describe("categoryForFile", () => {
  it("classifies by extension, case-insensitive", () => {
    expect(categoryForFile("a.PNG")).toBe("image");
    expect(categoryForFile("a.jpg")).toBe("image");
    expect(categoryForFile("a.webp")).toBe("image");
    expect(categoryForFile("a.heic")).toBe("heic");
    expect(categoryForFile("a.pdf")).toBe("pdf");
    expect(categoryForFile("a.mp4")).toBe("audio");
    expect(categoryForFile("a.wav")).toBe("audio");
  });
  it("returns null for unknown or extensionless", () => {
    expect(categoryForFile("a.xyz")).toBeNull();
    expect(categoryForFile("noext")).toBeNull();
  });
});

describe("outputsFor", () => {
  it("lists outputs in display order, first is default", () => {
    expect(outputsFor("image")).toEqual(["png", "jpg", "webp", "pdf"]);
    expect(outputsFor("heic")).toEqual(["png", "jpg", "pdf"]);
    expect(outputsFor("pdf")).toEqual(["png", "jpg"]);
    expect(outputsFor("audio")).toEqual(["mp3", "wav", "m4a"]);
  });
});

describe("isValidConversion", () => {
  it("accepts allowed pairs and rejects the rest", () => {
    expect(isValidConversion("a.png", "pdf")).toBe(true);
    expect(isValidConversion("a.pdf", "png")).toBe(true);
    expect(isValidConversion("a.mp4", "mp3")).toBe(true);
    expect(isValidConversion("a.mp4", "pdf")).toBe(false);
    expect(isValidConversion("a.png", "mp3")).toBe(false);
    expect(isValidConversion("a.xyz", "png")).toBe(false);
  });
});

describe("extFor / isAudioOutput", () => {
  it("maps outputs to extensions", () => {
    expect(extFor("jpg")).toBe("jpg");
    expect(extFor("png")).toBe("png");
    expect(extFor("pdf")).toBe("pdf");
    expect(extFor("m4a")).toBe("m4a");
  });
  it("flags audio outputs", () => {
    expect(isAudioOutput("mp3")).toBe(true);
    expect(isAudioOutput("wav")).toBe(true);
    expect(isAudioOutput("png")).toBe(false);
  });
});

describe("convertOutName", () => {
  it("swaps the extension, or uses -pages.zip for multi-page", () => {
    expect(convertOutName("holiday.png", "pdf", false)).toBe("holiday.pdf");
    expect(convertOutName("deck.pdf", "png", false)).toBe("deck.png");
    expect(convertOutName("deck.pdf", "png", true)).toBe("deck-pages.zip");
    expect(convertOutName("no-ext", "jpg", false)).toBe("no-ext.jpg");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx vitest run src/convert-formats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the catalog**

Create `packages/core/src/convert-formats.ts`:

```ts
export type ConvertCategory = "image" | "heic" | "pdf" | "audio";
export type OutputFormat = "png" | "jpg" | "webp" | "pdf" | "mp3" | "wav" | "m4a";

const EXT_CATEGORY: Record<string, ConvertCategory> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image",
  heic: "heic", heif: "heic",
  pdf: "pdf",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", flac: "audio",
  ogg: "audio", opus: "audio", mp4: "audio", mov: "audio", mkv: "audio",
  webm: "audio", avi: "audio", m4v: "audio",
};

const OUTPUTS: Record<ConvertCategory, OutputFormat[]> = {
  image: ["png", "jpg", "webp", "pdf"],
  heic: ["png", "jpg", "pdf"],
  pdf: ["png", "jpg"],
  audio: ["mp3", "wav", "m4a"],
};

const AUDIO_OUTPUTS = new Set<OutputFormat>(["mp3", "wav", "m4a"]);

function extname(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function basename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function categoryForFile(filename: string): ConvertCategory | null {
  return EXT_CATEGORY[extname(filename)] ?? null;
}

export function outputsFor(category: ConvertCategory): OutputFormat[] {
  return OUTPUTS[category];
}

export function isValidConversion(filename: string, output: OutputFormat): boolean {
  const cat = categoryForFile(filename);
  return cat !== null && OUTPUTS[cat].includes(output);
}

export function extFor(output: OutputFormat): string {
  return output; // jpg/png/webp/pdf/mp3/wav/m4a all equal their extension
}

export function isAudioOutput(output: OutputFormat): boolean {
  return AUDIO_OUTPUTS.has(output);
}

export function convertOutName(srcName: string, output: OutputFormat, zip: boolean): string {
  const base = basename(srcName) || "file";
  return zip ? `${base}-pages.zip` : `${base}.${extFor(output)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run src/convert-formats.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild core so web can import it**

Run: `cd /Users/caleb/event-editor && npm run -w @event-editor/core build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/convert-formats.ts packages/core/src/convert-formats.test.ts
git commit -m "feat(convert): format catalog — categories, valid outputs, naming"
```

---

### Task 3: audioArgs (pure core)

**Files:**
- Modify: `packages/core/src/convert.ts`
- Test: `packages/core/src/convert.test.ts` (create if absent, else add a describe block)

**Interfaces:**
- Consumes: existing `ffmpegMp3Args` in the same file (for reference).
- Produces: `audioArgs(inPath: string, outPath: string, format: "mp3" | "wav" | "m4a"): string[]`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/convert.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { audioArgs } from "./convert";

describe("audioArgs", () => {
  it("mp3 uses libmp3lame at 192k", () => {
    expect(audioArgs("in", "out.mp3", "mp3")).toEqual(
      ["-y", "-i", "in", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "out.mp3"],
    );
  });
  it("wav uses pcm_s16le", () => {
    expect(audioArgs("in", "out.wav", "wav")).toEqual(
      ["-y", "-i", "in", "-vn", "-c:a", "pcm_s16le", "out.wav"],
    );
  });
  it("m4a uses aac at 192k", () => {
    expect(audioArgs("in", "out.m4a", "m4a")).toEqual(
      ["-y", "-i", "in", "-vn", "-c:a", "aac", "-b:a", "192k", "out.m4a"],
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx vitest run src/convert.test.ts`
Expected: FAIL — `audioArgs` not exported.

- [ ] **Step 3: Implement `audioArgs`**

In `packages/core/src/convert.ts`, add:

```ts
// ffmpeg argv to extract/transcode an input's audio into the given format.
// mp3 mirrors ffmpegMp3Args; wav is lossless PCM; m4a is AAC.
export function audioArgs(
  inPath: string, outPath: string, format: "mp3" | "wav" | "m4a",
): string[] {
  const base = ["-y", "-i", inPath, "-vn"];
  if (format === "wav") return [...base, "-c:a", "pcm_s16le", outPath];
  if (format === "m4a") return [...base, "-c:a", "aac", "-b:a", "192k", outPath];
  return [...base, "-c:a", "libmp3lame", "-b:a", "192k", outPath];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run src/convert.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild core**

Run: `cd /Users/caleb/event-editor && npm run -w @event-editor/core build`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/convert.ts packages/core/src/convert.test.ts
git commit -m "feat(convert): audioArgs for mp3/wav/m4a ffmpeg output"
```

---

### Task 4: Image and image→pdf engines

**Files:**
- Create: `packages/web/lib/convert-file.ts` (image engines; pdf/audio added later tasks)
- Test: `packages/web/test/convert-file-image.test.ts`

**Interfaces:**
- Consumes: `sharp`; `PDFDocument` from `pdf-lib`; `heicToImage` from `@/lib/heic` (confirm its signature in that file — it returns a Buffer of png/jpeg given `{ format, quality }`).
- Produces:
  - `imageToRaster(input: Buffer, output: "png" | "jpg" | "webp"): Promise<Buffer>`
  - `imageToPdf(input: Buffer, srcName: string): Promise<Buffer>` (input already png/jpeg bytes)
  - `heicToRaster(input: Buffer, output: "png" | "jpg"): Promise<Buffer>`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/convert-file-image.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { imageToRaster, imageToPdf } from "@/lib/convert-file";

async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png().toBuffer();
}

describe("imageToRaster", () => {
  it("produces a real JPEG from a PNG", async () => {
    const out = await imageToRaster(await tinyPng(), "jpg");
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
  });
  it("produces a WEBP", async () => {
    const out = await imageToRaster(await tinyPng(), "webp");
    expect((await sharp(out).metadata()).format).toBe("webp");
  });
});

describe("imageToPdf", () => {
  it("produces a valid single-page PDF", async () => {
    const out = await imageToPdf(await tinyPng(), "x.png");
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && npx vitest run test/convert-file-image.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the image engines**

Create `packages/web/lib/convert-file.ts`:

```ts
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { heicToImage } from "@/lib/heic";

const LOSSY_QUALITY = 82;

// Raster image → png/jpg/webp. No resize (the resize tool owns that).
export async function imageToRaster(input: Buffer, output: "png" | "jpg" | "webp"): Promise<Buffer> {
  const img = sharp(input, { failOn: "none" });
  if (output === "png") return img.png().toBuffer();
  if (output === "webp") return img.webp({ quality: LOSSY_QUALITY }).toBuffer();
  return img.jpeg({ quality: LOSSY_QUALITY }).toBuffer();
}

// heic/heif → png/jpg via heic-convert (heicToImage returns png/jpeg bytes).
export async function heicToRaster(input: Buffer, output: "png" | "jpg"): Promise<Buffer> {
  return heicToImage(input, { format: output === "png" ? "PNG" : "JPEG", quality: LOSSY_QUALITY / 100 });
}

// png/jpeg bytes → one-page PDF sized exactly to the image.
export async function imageToPdf(input: Buffer, srcName: string): Promise<Buffer> {
  // Normalize to PNG so embedPng always works (input may be jpg/webp/etc).
  const png = await sharp(input, { failOn: "none" }).png().toBuffer();
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  return Buffer.from(await doc.save());
}
```

> Confirm `heicToImage`'s exact parameter shape in `packages/web/lib/heic.ts`. If it takes `{ format: "png" | "jpeg" }` (lowercase) or a different quality scale, adjust `heicToRaster` to match and note the deviation.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web && npx vitest run test/convert-file-image.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/convert-file.ts packages/web/test/convert-file-image.test.ts
git commit -m "feat(convert): image raster + image→pdf + heic engines"
```

---

### Task 5: PDF → image engine (pdfjs + @napi-rs/canvas)

**Files:**
- Modify: `packages/web/lib/convert-file.ts` (add pdf→image)
- Test: `packages/web/test/convert-file-pdf.test.ts`

**Interfaces:**
- Consumes: `pdfjs-dist/legacy/build/pdf.mjs`; `createCanvas` from `@napi-rs/canvas`; `zipFiles` from `@/lib/pdf` (confirm it exists and its signature — it zips `{ name, data }[]` into a Buffer).
- Produces: `pdfToImages(input: Buffer, output: "png" | "jpg"): Promise<{ data: Buffer; ext: string; zip: boolean }>` — single page → the image; multi-page → a zip.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/convert-file-pdf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { pdfToImages } from "@/lib/convert-file";

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

describe("pdfToImages", () => {
  it("single page → one png (not zipped)", async () => {
    const res = await pdfToImages(await makePdf(1), "png");
    expect(res.zip).toBe(false);
    expect(res.ext).toBe("png");
    expect(res.data.length).toBeGreaterThan(0);
  }, 30000);

  it("multi page → a zip with one entry per page", async () => {
    const res = await pdfToImages(await makePdf(2), "png");
    expect(res.zip).toBe(true);
    expect(res.ext).toBe("zip");
    const zip = await JSZip.loadAsync(res.data);
    expect(Object.keys(zip.files).length).toBe(2);
  }, 30000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && npx vitest run test/convert-file-pdf.test.ts`
Expected: FAIL — `pdfToImages` not exported.

- [ ] **Step 3: Implement pdf→image**

Add to `packages/web/lib/convert-file.ts`:

```ts
import { createCanvas } from "@napi-rs/canvas";
import { zipFiles } from "@/lib/pdf";

// Render every PDF page to a raster image at 2x. One page → the image;
// multiple → a zip of page-1.<ext>, page-2.<ext>, ...
export async function pdfToImages(
  input: Buffer, output: "png" | "jpg",
): Promise<{ data: Buffer; ext: string; zip: boolean }> {
  // Legacy build runs under Node without a DOM. Import lazily so the module
  // only loads server-side when a PDF is actually converted.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(input), isEvalSupported: false }).promise;
  const ext = output === "jpg" ? "jpg" : "png";
  const pages: { name: string; data: Buffer }[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      // pdfjs expects a canvas 2d context; @napi-rs/canvas is compatible.
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
      const data = ext === "jpg"
        ? await canvas.encode("jpeg", LOSSY_QUALITY)
        : await canvas.encode("png");
      pages.push({ name: `page-${n}.${ext}`, data: Buffer.from(data) });
      page.cleanup();
    }
  } finally {
    await doc.cleanup();
  }
  if (pages.length === 0) throw new Error("The PDF has no pages.");
  if (pages.length === 1) return { data: pages[0].data, ext, zip: false };
  return { data: await zipFiles(pages), ext: "zip", zip: true };
}
```

> Notes for the implementer: (1) confirm `zipFiles` in `packages/web/lib/pdf.ts` accepts `{ name, data }[]` and returns a `Buffer`; if its shape differs, adapt the call. (2) If `page.render` rejects with a password/encryption error, let it propagate — the route maps it (Task 7). (3) If pdfjs needs `disableWorker`/`useWorkerFetch` options under Node, add them; the legacy build normally runs worker-less in-process. (4) `canvas.encode` in `@napi-rs/canvas` is async and returns a `Buffer`/`Uint8Array`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web && npx vitest run test/convert-file-pdf.test.ts`
Expected: PASS (both cases). If it fails on the pdfjs/canvas integration, debug per the notes above before proceeding — this is the feature's main technical risk.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/convert-file.ts packages/web/test/convert-file-pdf.test.ts
git commit -m "feat(convert): pdf→image via pdfjs + @napi-rs/canvas, multi-page zip"
```

---

### Task 6: transcodeAudio + the dispatcher

**Files:**
- Modify: `packages/web/lib/convert.ts` (add `transcodeAudio`)
- Modify: `packages/web/lib/convert-file.ts` (add `convertUploaded`)
- Test: `packages/web/test/convert-dispatch.test.ts`

**Interfaces:**
- Consumes: existing `convertDir(id)` from `@/lib/convert`; `audioArgs` from `@event-editor/core/convert`; `categoryForFile`, `isAudioOutput`, `extFor` from `@event-editor/core/convert-formats`; the engines from Task 4/5.
- Produces:
  - `transcodeAudio(inPath: string, id: string, format: "mp3" | "wav" | "m4a"): Promise<void>` (writes `out.<ext>` in the convert dir; mirrors existing `transcodeToMp3`).
  - `convertUploaded(inPath: string, inputName: string, id: string, output: OutputFormat): Promise<{ ext: string; zip: boolean }>` — reads bytes, routes by category, writes `out.<ext>` in `convertDir(id)`, returns what was written.

- [ ] **Step 1: Write the failing test (dispatcher routing, image path only — no ffmpeg/pdf binaries)**

Create `packages/web/test/convert-dispatch.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";

// Point the job root at a temp dir so convertDir writes there.
const tmp = mkdtempSync(resolve(tmpdir(), "conv-"));
process.env.EE_DATA_DIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

import { convertUploaded } from "@/lib/convert-file";
import { convertDir } from "@/lib/convert";

describe("convertUploaded (image branch)", () => {
  it("routes png→jpg and writes out.jpg", async () => {
    const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: "#123456" } }).png().toBuffer();
    const id = "testjob1";
    const dir = convertDir(id);
    require("node:fs").mkdirSync(dir, { recursive: true });
    const inPath = resolve(dir, "source");
    writeFileSync(inPath, png);
    const res = await convertUploaded(inPath, "pic.png", id, "jpg");
    expect(res).toEqual({ ext: "jpg", zip: false });
    expect(existsSync(resolve(dir, "out.jpg"))).toBe(true);
    expect((await sharp(readFileSync(resolve(dir, "out.jpg"))).metadata()).format).toBe("jpeg");
  });

  it("rejects an invalid pair", async () => {
    const id = "testjob2";
    const dir = convertDir(id);
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "source"), Buffer.from("x"));
    await expect(convertUploaded(resolve(dir, "source"), "a.png", id, "mp3")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && npx vitest run test/convert-dispatch.test.ts`
Expected: FAIL — `convertUploaded` not exported.

- [ ] **Step 3: Implement `transcodeAudio` and `convertUploaded`**

In `packages/web/lib/convert.ts`, add (mirroring the existing `transcodeToMp3`, reusing the same ffmpeg spawn helper it uses — open the file and follow that pattern; use `audioArgs` for the argv):

```ts
import { audioArgs } from "@event-editor/core/convert";
// ... near transcodeToMp3:
export async function transcodeAudio(
  inPath: string, id: string, format: "mp3" | "wav" | "m4a",
): Promise<void> {
  const outPath = resolve(convertDir(id), `out.${format}`);
  await runFfmpeg(audioArgs(inPath, outPath, format)); // use the same spawn wrapper transcodeToMp3 uses
}
```

> Match the exact ffmpeg-spawn mechanism `transcodeToMp3` uses (it references `ffmpegPath` from `ffmpeg-static` and spawns). Name/reuse that helper rather than duplicating the spawn logic.

In `packages/web/lib/convert-file.ts`, add the dispatcher:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { convertDir, transcodeAudio } from "@/lib/convert";
import {
  categoryForFile, isAudioOutput, extFor, type OutputFormat,
} from "@event-editor/core/convert-formats";

export async function convertUploaded(
  inPath: string, inputName: string, id: string, output: OutputFormat,
): Promise<{ ext: string; zip: boolean }> {
  const category = categoryForFile(inputName);
  if (category === null) throw new Error("This file type isn't supported yet.");

  if (isAudioOutput(output)) {
    if (category !== "audio") throw new Error(`Cannot convert this file to ${output}.`);
    await transcodeAudio(inPath, id, output as "mp3" | "wav" | "m4a");
    return { ext: output, zip: false };
  }

  const dir = convertDir(id);
  const input = await readFile(inPath);

  if (category === "pdf") {
    if (output !== "png" && output !== "jpg") throw new Error(`Cannot convert a PDF to ${output}.`);
    const { data, ext, zip } = await pdfToImages(input, output);
    await writeFile(resolve(dir, `out.${ext}`), data);
    return { ext, zip };
  }

  if (category === "image" || category === "heic") {
    if (output === "pdf") {
      const png = category === "heic" ? await heicToRaster(input, "png") : input;
      const data = await imageToPdf(png, inputName);
      await writeFile(resolve(dir, "out.pdf"), data);
      return { ext: "pdf", zip: false };
    }
    if (output === "png" || output === "jpg" || output === "webp") {
      const data = category === "heic"
        ? await heicToRaster(input, output === "webp" ? "png" : output) // heic has no webp target; guarded by catalog
        : await imageToRaster(input, output);
      await writeFile(resolve(dir, `out.${extFor(output)}`), data);
      return { ext: extFor(output), zip: false };
    }
  }

  throw new Error(`Cannot convert this file to ${output}.`);
}
```

> The `heic + webp` branch is unreachable because the catalog never offers webp for heic; the inline guard is defensive. Keep it simple and correct.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web && npx vitest run test/convert-dispatch.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/convert.ts packages/web/lib/convert-file.ts packages/web/test/convert-dispatch.test.ts
git commit -m "feat(convert): transcodeAudio + convertUploaded dispatcher"
```

---

### Task 7: Generalize the route and download

**Files:**
- Modify: `packages/web/app/api/convert/file/route.ts`
- Modify: `packages/web/app/api/convert/[id]/route.ts`
- Test: `packages/web/test/convert-file-route.test.ts`

**Interfaces:**
- Consumes: `isValidConversion`, `isAudioOutput`, `convertOutName`, `type OutputFormat` from `@event-editor/core/convert-formats`; `convertUploaded` from `@/lib/convert-file`; existing `transcodeToMp3`/`convertDir`/`newConvertId`/`cleanupConvert`/`sweepOldConverts`.
- Produces: `POST /api/convert/file` accepts an `output` field (default `mp3`), validates, dispatches, returns `{ id, filename, ext }`; `GET /api/convert/[id]?ext=` serves `out.<ext>`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/convert-file-route.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";

const tmp = mkdtempSync(resolve(tmpdir(), "convroute-"));
process.env.EE_DATA_DIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

import { POST } from "@/app/api/convert/file/route";

function form(file: File, fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("file", file);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://x/api/convert/file", { method: "POST", body: fd });
}

describe("POST /api/convert/file", () => {
  it("png + output=jpg returns ext jpg", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer();
    const res = await POST(form(new File([png], "a.png", { type: "image/png" }), { output: "jpg" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ext).toBe("jpg");
    expect(body.filename).toBe("a.jpg");
  });

  it("invalid pair (png + output=mp3) returns 400", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer();
    const res = await POST(form(new File([png], "a.png", { type: "image/png" }), { output: "mp3" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && npx vitest run test/convert-file-route.test.ts`
Expected: FAIL — route still audio-only, `ext` undefined / no 400.

- [ ] **Step 3: Generalize the route**

Rewrite `packages/web/app/api/convert/file/route.ts`:

```ts
import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newConvertId, convertDir, transcodeToMp3, cleanupConvert, sweepOldConverts } from "@/lib/convert";
import { convertUploaded } from "@/lib/convert-file";
import { sanitizeMp3Filename, defaultNameFromSource } from "@event-editor/core/convert";
import { isValidConversion, isAudioOutput, convertOutName, type OutputFormat } from "@event-editor/core/convert-formats";

export const runtime = "nodejs";

const OUTPUTS = ["png", "jpg", "webp", "pdf", "mp3", "wav", "m4a"];

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const rawOut = form.get("output");
  const output = (typeof rawOut === "string" && OUTPUTS.includes(rawOut) ? rawOut : "mp3") as OutputFormat;

  if (!isValidConversion(file.name, output)) {
    return NextResponse.json({ error: `Can't convert this file to ${output}.` }, { status: 400 });
  }

  const id = newConvertId();
  const dir = convertDir(id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldConverts(6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  const inPath = resolve(dir, "source");
  try {
    await writeFile(inPath, Buffer.from(await file.arrayBuffer()));

    // Backward-compatible audio path: mp3 with the existing name sanitizer.
    if (isAudioOutput(output)) {
      if (output === "mp3") {
        const rawName = form.get("filename");
        const nameField = typeof rawName === "string" ? rawName.trim() : undefined;
        const name = sanitizeMp3Filename(nameField || defaultNameFromSource(file.name) || "audio");
        await transcodeToMp3(inPath, id);
        return NextResponse.json({ id, filename: name.endsWith(".mp3") ? name : `${name}.mp3`, ext: "mp3" });
      }
      const { ext, zip } = await convertUploaded(inPath, file.name, id, output);
      return NextResponse.json({ id, filename: convertOutName(file.name, output, zip), ext });
    }

    const { ext, zip } = await convertUploaded(inPath, file.name, id, output);
    return NextResponse.json({ id, filename: convertOutName(file.name, output, zip), ext });
  } catch (err) {
    try { await cleanupConvert(id); } catch { /* best-effort */ }
    const msg = err instanceof Error ? err.message : String(err);
    const friendly = /password|encrypt/i.test(msg) ? "This PDF is protected and can't be converted." : msg;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
```

> Verify the existing `transcodeToMp3` + `mp3Path` write `out.mp3` (or adjust the returned `ext`). Keep the mp3 filename behavior identical to before (the client shows a `.mp3` suffix).

- [ ] **Step 4: Generalize the download route for arbitrary ext**

Open `packages/web/app/api/convert/[id]/route.ts`. It currently serves `mp3Path(id)`. Change it to read `?ext=` (default `mp3`), serve `out.<ext>` from `convertDir(id)`, and set the content type from a small map. Mirror the existing `resize` download route's content-type map and disposition. Keep the `?name=` handling. Add types for `zip` (`application/zip`), `pdf`, `png`, `jpg` (`image/jpeg`), `wav` (`audio/wav`), `m4a` (`audio/mp4`), `mp3` (`audio/mpeg`), `webp`.

- [ ] **Step 5: Run the route test to verify it passes**

Run: `cd packages/web && npx vitest run test/convert-file-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/api/convert/file/route.ts "packages/web/app/api/convert/[id]/route.ts" packages/web/test/convert-file-route.test.ts
git commit -m "feat(convert): route accepts output format, arbitrary-ext download"
```

---

### Task 8: Client output dropdown + tool metadata

**Files:**
- Modify: `packages/web/app/convert/ConvertClient.tsx`
- Modify: `packages/web/app/convert/page.tsx`
- Modify: `packages/web/components/tools.ts`

**Interfaces:**
- Consumes: `categoryForFile`, `outputsFor`, `type OutputFormat` from `@event-editor/core/convert-formats`; existing `Segmented`, `uploadWithProgress`.
- Produces: file-mode UI with an Output-format `Segmented`; the download URL includes `?ext=`.

- [ ] **Step 1: Add output state and derive options on file select**

In `ConvertClient.tsx`:
- Add state: `const [output, setOutput] = useState<OutputFormat>("mp3");`
- In the file-select handler (where `hasFile`/`filename` is set from the chosen file), compute `const cat = categoryForFile(file.name);` and, if non-null, `const opts = outputsFor(cat); setOutput(opts[0]);` Store the resolved options in state (e.g. `outputOptions`) or recompute via `useMemo` from the current file name. If `cat` is null, set an `unsupported` flag.
- Render, only in file mode and once a file is chosen and supported, a `Segmented` labeled "Output format" whose options are `outputOptions.map(o => ({ value: o, label: o.toUpperCase() }))`, `value={output}`, `onChange={(v) => setOutput(v as OutputFormat)}`. When `unsupported`, render `<p className="text-sm text-muted">This file type isn't supported yet.</p>` and disable convert.

- [ ] **Step 2: Send `output` and use `ext` for download**

- In the file-mode submit, append `fd.set("output", output)` to the FormData before `uploadWithProgress`.
- The result JSON now includes `ext`. Store it on `result` (extend the `Result` interface to `{ id: string; filename: string; ext?: string }`).
- Build the download link as `/api/convert/${result.id}?ext=${result.ext ?? "mp3"}&name=${encodeURIComponent(result.filename)}`.
- Keep link-mode behavior unchanged (it posts to `/api/convert/url`, result is mp3; when rendering its download, default `ext` to `mp3`).

- [ ] **Step 3: Update the page title**

In `packages/web/app/convert/page.tsx`, change the `<h1>` from "Convert video to mp3" to "Convert a file".

- [ ] **Step 4: Update the tool registry entry**

In `packages/web/components/tools.ts`, update the `convert` entry:
- `title: "Convert a file"`
- `body: "Change a file's format. Images to png, jpg, webp, or pdf; pdf to images; audio and video to mp3, wav, or m4a. Or paste a link for audio."`
- `tags: ["convert", "image", "png", "jpg", "webp", "pdf", "audio", "mp3", "video", "youtube", "heic"]`
- Leave `id`, `href`, `Icon`, `defaultGroups`, and (per the badges feature) the absence of a `requires` field unchanged — convert stays unblocked.

- [ ] **Step 5: Verify build + typecheck**

Run: `cd packages/web && npx tsc --noEmit && npm run build`
Expected: build succeeds; no new tsc errors.

- [ ] **Step 6: Manual smoke (dev server)**

Run `npm run dev`. In file mode: choose a PNG → Output format shows PNG/JPG/WEBP/PDF, default PNG; pick PDF → convert → download is `a.pdf`. Choose an unsupported file (e.g. `.txt`) → "This file type isn't supported yet", no convert. Link mode still turns a URL into mp3. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/convert/ConvertClient.tsx packages/web/app/convert/page.tsx packages/web/components/tools.ts
git commit -m "feat(convert): output-format dropdown, tool copy for multi-format"
```

---

### Task 9: Full verification + packaged-app smoke

**Files:** none (verification only)

- [ ] **Step 1: Run both test suites**

Run: `cd packages/core && npm test` then `cd ../web && npm test`
Expected: all pass, including the new convert-formats, convert (audioArgs), convert-file-image, convert-file-pdf, convert-dispatch, and convert-file-route tests.

- [ ] **Step 2: Typecheck web**

Run: `cd packages/web && npx tsc --noEmit`
Expected: only the repo's pre-existing errors; none in files this plan touched.

- [ ] **Step 3: Packaged desktop smoke (proves @napi-rs/canvas ships)**

Run: `cd packages/desktop && npm run dist`
Then launch the built app, open Convert, upload a real 2-page PDF, choose PNG, convert, and confirm a zip downloads with two images. Also convert a real PNG → PDF. This is the definitive check that the native canvas is packaged and pdf→image works outside the dev tree. If `npm run dist` isn't feasible in this environment, note that and flag the packaged smoke as owed to the user.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test: verify multi-format convert suite green"
```

---

## Self-Review notes

- **Spec coverage:** catalog (Task 2), audio args (Task 3), image/heic/pdf engines (Tasks 4-5), audio transcode + dispatcher (Task 6), route + download (Task 7), UI + metadata (Task 8), deps + packaging (Task 1), verification incl. packaged smoke (Task 9).
- **Backward compatibility:** the route defaults `output` to `mp3` and preserves the exact mp3 filename path; link mode untouched.
- **Type consistency:** `OutputFormat`, `ConvertCategory`, `categoryForFile`, `outputsFor`, `isValidConversion`, `isAudioOutput`, `extFor`, `convertOutName`, `convertUploaded`, `transcodeAudio`, `imageToRaster`, `heicToRaster`, `imageToPdf`, `pdfToImages` are named identically across tasks.
- **Main risk (pdf→image / @napi-rs/canvas):** isolated in Tasks 1, 5, and the Task 9 packaged smoke, so packaging problems surface early and are provable.
- **Open items for the reviewer:** (a) v1 scope excludes batch, quality slider, docx/pptx, video-format output (spec §Goal) — veto if wanted; (b) confirm `heicToImage` and `zipFiles` real signatures during Tasks 4/5 and adjust calls; (c) whether the mp3 result filename should carry `.mp3` (kept as-is).
