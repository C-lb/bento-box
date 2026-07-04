# Spec B Utility Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 new self-contained tools (HEIC convert, image resize, PDF merge/split/compress, video compress, trim-&-join clips, QR generator) to the event-editor tool shell, each following the existing `convert` tool's core → lib → api → page → registry pattern.

**Architecture:** Pure, unit-tested helpers live in `packages/core/src/<tool>.ts` (arg-builders, filename derivation, option normalisation). IO lives in `packages/web/lib/<tool>.ts` (sharp / pdf-lib / ffmpeg / heic-convert). Next.js route handlers under `packages/web/app/api/<tool>/` accept a multipart POST (one file per request, except PDF-split output and splice input), create a job dir under `data/<tool>/<id>/`, process, and return `{ id, filename }`; a `GET /api/<tool>/[id]` streams the output. Client components under `packages/web/app/<tool>/` mirror `ConvertClient.tsx`.

**Tech Stack:** TypeScript, Next.js (app router, `runtime = "nodejs"`), React client components, vitest. Libs: `sharp`, `pdf-lib`, `jszip`, `ffmpeg-static` (already installed); `heic-convert`, `qrcode`, `@types/qrcode` (new). Core builds with `tsc`; web tests with `vitest run`.

## Global Constraints

- **Monorepo:** pnpm/npm workspaces. `@event-editor/core` is consumed via subpath exports (`@event-editor/core/<name>`), which map to `dist/<name>.js`. **After any change to `packages/core/src`, run `npm run build` in `packages/core`** so the subpath resolves — Turbopack will not read `src` directly.
- **Core subpath exports:** every new `core/src/<tool>.ts` must be added to `packages/core/package.json` `exports` as `"./<tool>": "./dist/<tool>.js"`.
- **Core test imports** use the `.js` extension on the source path: `import { x } from "../src/heic.js"`.
- **Route handlers** must declare `export const runtime = "nodejs";` (native modules + fs).
- **Working dirs** honour `EE_DATA_DIR` (packaged app writes outside cwd). Never hardcode `data/` — use `dataRoot()` from `lib/jobs.ts`.
- **Job ids** are always passed through `sanitizeJobId` before touching the filesystem.
- **House UI:** anti-vibecode. Reuse existing classes `.card`, `.field`, `.btn`, `.btn-accent`, `.eyebrow`, `.text-muted`, `.text-danger`, `.text-success`, `.shadow-raisededge`, and the `Segmented` component (`@/components/Segmented`). One accent, neutral rest, sentence-case labels, no em dashes in UI copy. Icons from `lucide-react`.
- **Copy voice:** plain, human, sentence case. No em dashes in any user-facing string.
- **Best-effort sweep:** each processing POST calls `sweepOldJobs(tool, 6 * 60 * 60 * 1000)` in a try/catch before work, mirroring convert.
- **Commits:** conventional, atomic per step. End every commit message body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Push to `main` after each task completes (repo default).

## File Structure

Shared (Task 1):
- Create `packages/web/lib/jobs.ts` — job-dir machinery generalised from `lib/convert.ts`.
- Create `packages/web/lib/spawn.ts` — the `run(bin, args)` child-process helper.
- Create `packages/core/src/names.ts` — shared filename sanitiser + extension swap.

Per tool (Tasks 2–7), e.g. HEIC:
- Create `packages/core/src/heic.ts` + `packages/core/test/heic.test.ts`
- Create `packages/web/lib/heic.ts`
- Create `packages/web/app/api/heic/route.ts` + `packages/web/app/api/heic/[id]/route.ts`
- Create `packages/web/app/heic/page.tsx` + `packages/web/app/heic/HeicClient.tsx`
- Modify `packages/core/package.json` (exports)

Registry (Task 8):
- Modify `packages/web/components/tools.ts` (6 entries)
- Modify `packages/web/components/tool-store.ts` (add `utilities` group)

---

## Task 1: Shared job + spawn infra and core name helper

**Files:**
- Create: `packages/core/src/names.ts`
- Create: `packages/core/test/names.test.ts`
- Create: `packages/web/lib/jobs.ts`
- Create: `packages/web/lib/spawn.ts`
- Modify: `packages/core/package.json` (add `"./names"` export)

**Interfaces:**
- Produces (core `names.ts`): `safeBase(raw: string): string` — sanitised filename base (no extension); `swapExt(name: string, ext: string): string` — replace/append extension, ext without dot.
- Produces (`lib/jobs.ts`): `dataRoot(): string`, `sanitizeJobId(id: string): string`, `newJobId(): string`, `jobDir(tool: string, id: string): string`, `cleanupJob(tool: string, id: string): Promise<void>`, `sweepOldJobs(tool: string, maxAgeMs: number): Promise<void>`.
- Produces (`lib/spawn.ts`): `run(bin: string, args: string[]): Promise<string>`, `ffmpegBin(): string` (throws if missing), `ffmpegDir(): string`.

- [ ] **Step 1: Write the failing test for names**

`packages/core/test/names.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { safeBase, swapExt } from "../src/names.js";

describe("safeBase", () => {
  it("strips unsafe chars and collapses runs", () => {
    expect(safeBase("../a/b:c*?.png")).toBe("a_b_c.png".replace(/\.png$/, "")); // no ext handling here
  });
  it("keeps a plain base", () => {
    expect(safeBase("holiday photo")).toBe("holiday_photo");
  });
  it("falls back to empty for all-unsafe input", () => {
    expect(safeBase("///")).toBe("");
  });
});

describe("swapExt", () => {
  it("replaces an existing extension", () => {
    expect(swapExt("IMG_1234.HEIC", "jpg")).toBe("IMG_1234.jpg");
  });
  it("appends when there is no extension", () => {
    expect(swapExt("clip", "mp4")).toBe("clip.mp4");
  });
  it("sanitises the base", () => {
    expect(swapExt("my file:v2.heic", "png")).toBe("my_file_v2.png");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/core && npx vitest run test/names.test.ts`
Expected: FAIL — cannot find module `../src/names.js`.

- [ ] **Step 3: Implement `names.ts`**

`packages/core/src/names.ts`:
```typescript
// Shared filename hygiene for the utility tools. Mirrors convert.ts's private
// safeBase but is exported for reuse.
export function safeBase(raw: string): string {
  return raw
    .replace(/[\/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 120);
}

// Replace (or append) a file extension. `ext` is given without a dot.
export function swapExt(name: string, ext: string): string {
  const withoutExt = name.replace(/\.[a-z0-9]{1,5}$/i, "");
  const base = safeBase(withoutExt) || "file";
  return `${base}.${ext}`;
}
```

- [ ] **Step 4: Run names test to verify pass**

Run: `cd packages/core && npx vitest run test/names.test.ts`
Expected: PASS (3 + 3).

- [ ] **Step 5: Add the core export and build**

In `packages/core/package.json` `exports`, add:
```json
"./names": "./dist/names.js",
```
Run: `cd packages/core && npm run build`
Expected: tsc succeeds, `dist/names.js` exists.

- [ ] **Step 6: Implement `lib/jobs.ts`**

`packages/web/lib/jobs.ts`:
```typescript
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { rm, readdir, stat } from "node:fs/promises";

export function dataRoot(): string {
  return process.env.EE_DATA_DIR ?? "data";
}
export function sanitizeJobId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}
export function newJobId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}
export function jobDir(tool: string, id: string): string {
  return resolve(dataRoot(), tool, sanitizeJobId(id));
}
export async function cleanupJob(tool: string, id: string): Promise<void> {
  await rm(jobDir(tool, id), { recursive: true, force: true });
}
export async function sweepOldJobs(tool: string, maxAgeMs: number): Promise<void> {
  const root = resolve(dataRoot(), tool);
  let entries: string[];
  try { entries = await readdir(root); } catch { return; }
  const now = Date.now();
  for (const name of entries) {
    const p = resolve(root, name);
    try {
      const s = await stat(p);
      if (s.isDirectory() && now - s.mtimeMs > maxAgeMs) {
        await rm(p, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }
}
```

- [ ] **Step 7: Implement `lib/spawn.ts`**

`packages/web/lib/spawn.ts`:
```typescript
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export function run(bin: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const proc = spawn(bin, args);
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", rej);
    proc.on("close", (code) =>
      code === 0 ? res(out) : rej(new Error(err.trim() || `${bin} exited ${code}`)),
    );
  });
}

export function ffmpegBin(): string {
  if (!ffmpegPath) throw new Error("bundled ffmpeg not found");
  return ffmpegPath;
}
export function ffmpegDir(): string {
  return dirname(ffmpegBin());
}
```

- [ ] **Step 8: Typecheck web and commit**

Run: `cd packages/web && npx tsc --noEmit` (expect only the 5 pre-existing errors, no new ones referencing jobs/spawn).
```bash
git add packages/core/src/names.ts packages/core/test/names.test.ts packages/core/package.json packages/web/lib/jobs.ts packages/web/lib/spawn.ts
git commit -m "feat(tools): shared job dir + spawn infra and core name helpers"
```

---

## Task 2: HEIC → jpg/png tool (`heic`)

**Files:**
- Create: `packages/core/src/heic.ts` + `packages/core/test/heic.test.ts`
- Create: `packages/web/lib/heic.ts`
- Create: `packages/web/app/api/heic/route.ts` + `packages/web/app/api/heic/[id]/route.ts`
- Create: `packages/web/app/heic/page.tsx` + `packages/web/app/heic/HeicClient.tsx`
- Modify: `packages/core/package.json` (`"./heic"` export)
- Add dep: `heic-convert` (in `packages/web`)

**Interfaces:**
- Consumes: `swapExt` from `@event-editor/core/names`; `jobDir/newJobId/sanitizeJobId/cleanupJob/sweepOldJobs` from `@/lib/jobs`.
- Produces (core): `type HeicFormat = "jpg" | "png"`; `normalizeHeicOpts(raw: { format?: string; quality?: number }): { format: HeicFormat; quality: number }` (quality 1–100, default 82, clamped; format guard defaulting to `jpg`); `heicOutName(srcName: string, format: HeicFormat): string`.
- Produces (lib): `heicToImage(input: Buffer, opts: { format: HeicFormat; quality: number }): Promise<Buffer>`.
- Produces (route): POST `/api/heic` form `{ file, format, quality }` → `{ id, filename }`; GET `/api/heic/[id]?name=` streams `out.<ext>`.

- [ ] **Step 1: Install heic-convert**

Run: `cd packages/web && npm install heic-convert && npm install -D @types/heic-convert`
Expected: added to `packages/web/package.json`. (If `@types/heic-convert` 404s, add `packages/web/types/heic-convert.d.ts` with `declare module "heic-convert";` — note it in the commit.)

- [ ] **Step 2: Write the failing core test**

`packages/core/test/heic.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeHeicOpts, heicOutName } from "../src/heic.js";

describe("normalizeHeicOpts", () => {
  it("defaults to jpg at quality 82", () => {
    expect(normalizeHeicOpts({})).toEqual({ format: "jpg", quality: 82 });
  });
  it("clamps quality into 1..100", () => {
    expect(normalizeHeicOpts({ quality: 0 }).quality).toBe(1);
    expect(normalizeHeicOpts({ quality: 500 }).quality).toBe(100);
  });
  it("accepts png and ignores unknown formats", () => {
    expect(normalizeHeicOpts({ format: "png" }).format).toBe("png");
    expect(normalizeHeicOpts({ format: "gif" }).format).toBe("jpg");
  });
});

describe("heicOutName", () => {
  it("swaps the extension to the chosen format", () => {
    expect(heicOutName("IMG_0421.HEIC", "png")).toBe("IMG_0421.png");
  });
});
```

- [ ] **Step 3: Run it, verify fail**

Run: `cd packages/core && npx vitest run test/heic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `core/src/heic.ts`**

```typescript
import { swapExt } from "./names.js";

export type HeicFormat = "jpg" | "png";

export function normalizeHeicOpts(raw: { format?: string; quality?: number }): {
  format: HeicFormat;
  quality: number;
} {
  const format: HeicFormat = raw.format === "png" ? "png" : "jpg";
  const q = Number.isFinite(raw.quality) ? Math.round(raw.quality as number) : 82;
  const quality = Math.min(100, Math.max(1, q));
  return { format, quality };
}

export function heicOutName(srcName: string, format: HeicFormat): string {
  return swapExt(srcName, format);
}
```

- [ ] **Step 5: Add export, build, verify test passes**

Add `"./heic": "./dist/heic.js"` to `packages/core/package.json` exports.
Run: `cd packages/core && npm run build && npx vitest run test/heic.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement `lib/heic.ts`**

```typescript
import convert from "heic-convert";
import type { HeicFormat } from "@event-editor/core/heic";

export async function heicToImage(
  input: Buffer,
  opts: { format: HeicFormat; quality: number },
): Promise<Buffer> {
  const out = await convert({
    buffer: input,
    format: opts.format === "png" ? "PNG" : "JPEG",
    quality: opts.quality / 100, // heic-convert wants 0..1
  });
  return Buffer.from(out);
}
```

- [ ] **Step 7: Implement the POST route**

`packages/web/app/api/heic/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newJobId, jobDir, cleanupJob, sweepOldJobs } from "@/lib/jobs";
import { normalizeHeicOpts, heicOutName } from "@event-editor/core/heic";
import { heicToImage } from "@/lib/heic";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const opts = normalizeHeicOpts({
    format: typeof form.get("format") === "string" ? String(form.get("format")) : undefined,
    quality: form.get("quality") != null ? Number(form.get("quality")) : undefined,
  });
  const filename = heicOutName(file.name || "image", opts.format);

  const id = newJobId();
  const dir = jobDir("heic", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("heic", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const out = await heicToImage(buf, opts);
    await writeFile(resolve(dir, `out.${opts.format}`), out);
    return NextResponse.json({ id, filename, format: opts.format });
  } catch (err) {
    try { await cleanupJob("heic", id); } catch { /* best-effort */ }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 8: Implement the download route**

`packages/web/app/api/heic/[id]/route.ts`:
```typescript
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jobDir, sanitizeJobId } from "@/lib/jobs";
import { safeBase } from "@event-editor/core/names";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const fmt = url.searchParams.get("format") === "png" ? "png" : "jpg";
  const name = `${safeBase(url.searchParams.get("name") || "image") || "image"}`;
  try {
    const bytes = await readFile(resolve(jobDir("heic", sanitizeJobId(id)), `out.${fmt}`));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": fmt === "png" ? "image/png" : "image/jpeg",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
```

- [ ] **Step 9: Implement page + client**

`packages/web/app/heic/page.tsx`:
```typescript
import { HeicClient } from "./HeicClient";

export default function HeicPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Convert HEIC photos</h1>
      <HeicClient />
    </div>
  );
}
```

`packages/web/app/heic/HeicClient.tsx` — a client component. Read `app/convert/ConvertClient.tsx` for the house classes, the busy/error state pattern, and the download-link markup, then build this shape:
- State: `format: "jpg" | "png"` (default `jpg`), `quality: number` (default 82), and a `rows: { key; name; status: "idle"|"busy"|"done"|"error"; id?; filename?; error? }[]` — one per selected file.
- A `<input type="file" multiple accept=".heic,.heif,image/heic,image/heif">`; on change, seed a row per file (status `idle`).
- Format `Segmented` (`jpg` / `png`); a quality `<input type="range" min={1} max={100}>` shown only when `format === "jpg"`.
- A "Convert all" `.btn.btn-accent` that loops rows, for each: set `busy`, POST `FormData { file, format, quality }` to `/api/heic`, on success set `done` + `{ id, filename }`, on failure set `error` + message.
- Each `done` row shows a `.btn` download `<a href={`/api/heic/${id}?name=${encodeURIComponent(filename)}&format=${format}`} download>` with the `Download` icon (mirror ConvertClient's download block).
- Error rows show `text-danger` with a per-row retry button that re-runs just that row.
Use `Loader2` spinner while busy. No Drive save (out of scope here).

- [ ] **Step 10: Manual smoke + commit**

Run: `cd packages/web && npm run dev` (or the project run skill). Load `http://localhost:3000/heic`, convert a real `.heic` file to both jpg and png, download each, confirm they open.
```bash
git add packages/core/src/heic.ts packages/core/test/heic.test.ts packages/core/package.json packages/web/lib/heic.ts packages/web/app/api/heic packages/web/app/heic packages/web/package.json packages/web/package-lock.json
git commit -m "feat(tools): HEIC to jpg/png converter"
```

---

## Task 3: Image compress / resize tool (`resize`)

**Files:**
- Create: `packages/core/src/resize.ts` + `packages/core/test/resize.test.ts`
- Create: `packages/web/lib/resize.ts`
- Create: `packages/web/app/api/resize/route.ts` + `packages/web/app/api/resize/[id]/route.ts`
- Create: `packages/web/app/resize/page.tsx` + `packages/web/app/resize/ResizeClient.tsx`
- Modify: `packages/core/package.json` (`"./resize"` export)

**Interfaces:**
- Consumes: `swapExt` from `@event-editor/core/names`; `@/lib/jobs`; `sharp`.
- Produces (core): `type ResizeFormat = "keep" | "jpg" | "png" | "webp"`; `normalizeResizeOpts(raw): { maxW: number | null; maxH: number | null; format: ResizeFormat; quality: number }` (maxW/maxH positive ints or null; quality 1–100 default 80); `resizeOutName(srcName, format, srcExt): string` (keeps original ext when `keep`); `sharpFormat(format, srcName): "jpeg" | "png" | "webp"` mapping (keep → infer from srcName ext, defaulting jpeg).
- Produces (lib): `resizeImage(input: Buffer, opts, srcName: string): Promise<{ data: Buffer; ext: string }>`.
- Produces (route): POST `/api/resize` form `{ file, maxW, maxH, format, quality }` → `{ id, filename, bytesIn, bytesOut }`; GET `/api/resize/[id]?name=&ext=`.

- [ ] **Step 1: Write the failing core test**

`packages/core/test/resize.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeResizeOpts, resizeOutName, sharpFormat } from "../src/resize.js";

describe("normalizeResizeOpts", () => {
  it("defaults to keep format, no bounds, quality 80", () => {
    expect(normalizeResizeOpts({})).toEqual({ maxW: null, maxH: null, format: "keep", quality: 80 });
  });
  it("parses positive integer bounds and drops junk", () => {
    expect(normalizeResizeOpts({ maxW: 1920, maxH: 0 })).toMatchObject({ maxW: 1920, maxH: null });
    expect(normalizeResizeOpts({ maxW: -5 }).maxW).toBeNull();
  });
  it("clamps quality", () => {
    expect(normalizeResizeOpts({ quality: 999 }).quality).toBe(100);
  });
  it("guards format", () => {
    expect(normalizeResizeOpts({ format: "tiff" }).format).toBe("keep");
    expect(normalizeResizeOpts({ format: "webp" }).format).toBe("webp");
  });
});

describe("sharpFormat", () => {
  it("infers from source when keep", () => {
    expect(sharpFormat("keep", "a.png")).toBe("png");
    expect(sharpFormat("keep", "a.jpeg")).toBe("jpeg");
    expect(sharpFormat("keep", "a.bmp")).toBe("jpeg"); // fallback
  });
  it("uses the explicit format otherwise", () => {
    expect(sharpFormat("webp", "a.png")).toBe("webp");
    expect(sharpFormat("jpg", "a.png")).toBe("jpeg");
  });
});

describe("resizeOutName", () => {
  it("keeps original extension when keep", () => {
    expect(resizeOutName("Beach.PNG", "keep", "png")).toBe("Beach.png");
  });
  it("swaps to the chosen format", () => {
    expect(resizeOutName("Beach.png", "webp", "png")).toBe("Beach.webp");
  });
});
```

- [ ] **Step 2: Run it, verify fail**

Run: `cd packages/core && npx vitest run test/resize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `core/src/resize.ts`**

```typescript
import { swapExt } from "./names.js";

export type ResizeFormat = "keep" | "jpg" | "png" | "webp";
type SharpFmt = "jpeg" | "png" | "webp";

function posIntOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}

export function normalizeResizeOpts(raw: {
  maxW?: unknown; maxH?: unknown; format?: string; quality?: unknown;
}): { maxW: number | null; maxH: number | null; format: ResizeFormat; quality: number } {
  const format: ResizeFormat =
    raw.format === "jpg" || raw.format === "png" || raw.format === "webp" ? raw.format : "keep";
  const q = Number.isFinite(Number(raw.quality)) ? Math.round(Number(raw.quality)) : 80;
  return {
    maxW: posIntOrNull(raw.maxW),
    maxH: posIntOrNull(raw.maxH),
    format,
    quality: Math.min(100, Math.max(1, q)),
  };
}

export function sharpFormat(format: ResizeFormat, srcName: string): SharpFmt {
  if (format === "jpg") return "jpeg";
  if (format === "png") return "png";
  if (format === "webp") return "webp";
  const ext = (srcName.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  return "jpeg";
}

export function resizeOutName(srcName: string, format: ResizeFormat, srcExt: string): string {
  const ext = format === "keep" ? (srcExt || "jpg").toLowerCase() : format;
  return swapExt(srcName, ext === "jpeg" ? "jpg" : ext);
}
```

- [ ] **Step 4: Add export, build, verify pass**

Add `"./resize": "./dist/resize.js"`. Run: `cd packages/core && npm run build && npx vitest run test/resize.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `lib/resize.ts`**

```typescript
import sharp from "sharp";
import { sharpFormat, type ResizeFormat } from "@event-editor/core/resize";

export async function resizeImage(
  input: Buffer,
  opts: { maxW: number | null; maxH: number | null; format: ResizeFormat; quality: number },
  srcName: string,
): Promise<{ data: Buffer; ext: string }> {
  let img = sharp(input, { failOn: "none" });
  if (opts.maxW || opts.maxH) {
    img = img.resize({
      width: opts.maxW ?? undefined,
      height: opts.maxH ?? undefined,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const fmt = sharpFormat(opts.format, srcName);
  const data =
    fmt === "png"
      ? await img.png({ quality: opts.quality }).toBuffer()
      : fmt === "webp"
        ? await img.webp({ quality: opts.quality }).toBuffer()
        : await img.jpeg({ quality: opts.quality }).toBuffer();
  return { data, ext: fmt === "jpeg" ? "jpg" : fmt };
}
```

- [ ] **Step 6: Implement POST route**

`packages/web/app/api/resize/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newJobId, jobDir, cleanupJob, sweepOldJobs } from "@/lib/jobs";
import { normalizeResizeOpts, resizeOutName } from "@event-editor/core/resize";
import { resizeImage } from "@/lib/resize";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const opts = normalizeResizeOpts({
    maxW: form.get("maxW"),
    maxH: form.get("maxH"),
    format: typeof form.get("format") === "string" ? String(form.get("format")) : undefined,
    quality: form.get("quality"),
  });

  const id = newJobId();
  const dir = jobDir("resize", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("resize", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    const inBuf = Buffer.from(await file.arrayBuffer());
    const { data, ext } = await resizeImage(inBuf, opts, file.name || "image");
    await writeFile(resolve(dir, `out.${ext}`), data);
    const srcExt = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
    return NextResponse.json({
      id,
      filename: resizeOutName(file.name || "image", opts.format, srcExt),
      ext,
      bytesIn: inBuf.length,
      bytesOut: data.length,
    });
  } catch (err) {
    try { await cleanupJob("resize", id); } catch { /* best-effort */ }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 7: Implement download route**

`packages/web/app/api/resize/[id]/route.ts` — same shape as HEIC's `[id]` route, but read `out.<ext>` where `ext` comes from `url.searchParams.get("ext")` (guard to `jpg|png|webp`, default `jpg`) and set `Content-Type` accordingly (`image/jpeg|image/png|image/webp`). Filename from `safeBase(name)`.

- [ ] **Step 8: Implement page + client**

`page.tsx`: `<h1>Compress or resize images</h1>` + `<ResizeClient />`.
`ResizeClient.tsx` — mirror `HeicClient` structure (multi-file rows, loop POST) with these controls: two number inputs `maxW` / `maxH` (placeholder "no limit"), a format `Segmented` (`keep | jpg | png | webp`), a quality range (1–100, default 80). Accept `image/*`. Each done row shows the reduction: `${(bytesIn/1024).toFixed(0)} KB → ${(bytesOut/1024).toFixed(0)} KB` and a download `<a href={`/api/resize/${id}?name=${encodeURIComponent(filename)}&ext=${ext}`} download>`.

- [ ] **Step 9: Manual smoke + commit**

Load `/resize`, shrink a large jpg to maxW 1024 webp, confirm the reduction and that the file opens.
```bash
git add packages/core/src/resize.ts packages/core/test/resize.test.ts packages/core/package.json packages/web/lib/resize.ts packages/web/app/api/resize packages/web/app/resize
git commit -m "feat(tools): image compress and resize"
```

---

## Task 4: PDF merge / split / compress tool (`pdf`)

**Files:**
- Create: `packages/core/src/pdf.ts` + `packages/core/test/pdf.test.ts`
- Create: `packages/web/lib/pdf.ts`
- Create: `packages/web/app/api/pdf/[mode]/route.ts` + `packages/web/app/api/pdf/[id]/route.ts`
- Create: `packages/web/app/pdf/page.tsx` + `packages/web/app/pdf/PdfClient.tsx`
- Modify: `packages/core/package.json` (`"./pdf"` export)

**Note on route collision:** `[mode]` (merge|split|compress) and `[id]` are sibling dynamic segments under `/api/pdf`. Next.js forbids two different dynamic slug names at the same level. **Resolve by nesting the processors:** use `POST /api/pdf/process/[mode]` and `GET /api/pdf/file/[id]`. Create `app/api/pdf/process/[mode]/route.ts` and `app/api/pdf/file/[id]/route.ts`.

**Interfaces:**
- Consumes: `@/lib/jobs`; `pdf-lib` (`PDFDocument`); `jszip`.
- Produces (core): `parsePageRanges(spec: string, pageCount: number): number[][]` — each inner array is a 0-based, ascending, inclusive page list for one output; throws `Error` with a readable message on malformed spec or out-of-range page; `pdfOutName(base: string, suffix: string): string`.
- Produces (lib): `mergePdfs(buffers: Buffer[]): Promise<Buffer>`; `splitPdf(buffer: Buffer, ranges: number[][], opts: { single: boolean }): Promise<{ name: string; data: Buffer }[]>`; `resavePdf(buffer: Buffer): Promise<Buffer>`; `zipFiles(files: { name: string; data: Buffer }[]): Promise<Buffer>`.
- Produces (route): POST `/api/pdf/process/[mode]` form (merge: many `file`; split: one `file` + `ranges` + `single`; compress: one `file`) → `{ id, filename }`. GET `/api/pdf/file/[id]?name=&kind=pdf|zip`.

- [ ] **Step 1: Write the failing core test**

`packages/core/test/pdf.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parsePageRanges } from "../src/pdf.js";

describe("parsePageRanges", () => {
  it("parses comma-separated ranges and singles into 0-based lists", () => {
    expect(parsePageRanges("1-3, 5, 8-10", 10)).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
  });
  it("tolerates whitespace and trailing commas", () => {
    expect(parsePageRanges(" 2 , 4 - 5 , ", 5)).toEqual([[1], [3, 4]]);
  });
  it("throws on a page beyond the document", () => {
    expect(() => parsePageRanges("1-99", 3)).toThrow(/only 3 pages/i);
  });
  it("throws on a descending range", () => {
    expect(() => parsePageRanges("5-2", 10)).toThrow(/invalid range/i);
  });
  it("throws on non-numeric input", () => {
    expect(() => parsePageRanges("abc", 10)).toThrow(/could not read/i);
  });
});
```

- [ ] **Step 2: Run it, verify fail**

Run: `cd packages/core && npx vitest run test/pdf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `core/src/pdf.ts`**

```typescript
import { safeBase } from "./names.js";

// Parse a human page-range spec ("1-3, 5, 8-10") into per-output lists of
// 0-based page indices. Pages are 1-based in the spec, inclusive.
export function parsePageRanges(spec: string, pageCount: number): number[][] {
  const parts = spec.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) throw new Error("Enter at least one page or range, like 1-3, 5");
  const out: number[][] = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`Could not read "${part}". Use page numbers like 1-3, 5`);
    const start = Number(m[1]);
    const end = m[2] != null ? Number(m[2]) : start;
    if (start < 1 || end < 1) throw new Error(`Pages start at 1 (saw "${part}")`);
    if (end < start) throw new Error(`Invalid range "${part}" — the end is before the start`);
    if (end > pageCount) throw new Error(`"${part}" is out of range — the file only has ${pageCount} pages`);
    const list: number[] = [];
    for (let p = start; p <= end; p++) list.push(p - 1);
    out.push(list);
  }
  return out;
}

export function pdfOutName(base: string, suffix: string): string {
  const b = safeBase(base.replace(/\.pdf$/i, "")) || "document";
  return `${b}${suffix}`;
}
```

- [ ] **Step 4: Add export, build, verify pass**

Add `"./pdf": "./dist/pdf.js"`. Run: `cd packages/core && npm run build && npx vitest run test/pdf.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `lib/pdf.ts`**

```typescript
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

export async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return Buffer.from(await out.save({ useObjectStreams: true }));
}

export async function splitPdf(
  buffer: Buffer,
  ranges: number[][],
  opts: { single: boolean },
): Promise<{ name: string; data: Buffer }[]> {
  const src = await PDFDocument.load(buffer);
  if (opts.single) {
    const out = await PDFDocument.create();
    const flat = ranges.flat();
    const pages = await out.copyPages(src, flat);
    for (const p of pages) out.addPage(p);
    return [{ name: "selected.pdf", data: Buffer.from(await out.save()) }];
  }
  const files: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, ranges[i]);
    for (const p of pages) out.addPage(p);
    files.push({ name: `part-${i + 1}.pdf`, data: Buffer.from(await out.save()) });
  }
  return files;
}

export async function resavePdf(buffer: Buffer): Promise<Buffer> {
  const src = await PDFDocument.load(buffer);
  return Buffer.from(await src.save({ useObjectStreams: true }));
}

export async function pageCount(buffer: Buffer): Promise<number> {
  return (await PDFDocument.load(buffer)).getPageCount();
}

export async function zipFiles(files: { name: string; data: Buffer }[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.data);
  return zip.generateAsync({ type: "nodebuffer" });
}
```

- [ ] **Step 6: Implement the process route**

`packages/web/app/api/pdf/process/[mode]/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newJobId, jobDir, cleanupJob, sweepOldJobs } from "@/lib/jobs";
import { parsePageRanges, pdfOutName } from "@event-editor/core/pdf";
import { mergePdfs, splitPdf, resavePdf, zipFiles, pageCount } from "@/lib/pdf";

export const runtime = "nodejs";

async function filesToBuffers(files: File[]): Promise<Buffer[]> {
  return Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
}

export async function POST(request: Request, { params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Add at least one PDF" }, { status: 400 });

  const id = newJobId();
  const dir = jobDir("pdf", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("pdf", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    const bufs = await filesToBuffers(files);
    const base = (files[0].name || "document").replace(/\.pdf$/i, "");

    if (mode === "merge") {
      const out = await mergePdfs(bufs);
      await writeFile(resolve(dir, "out.pdf"), out);
      return NextResponse.json({ id, filename: pdfOutName(base, "-merged.pdf"), kind: "pdf" });
    }
    if (mode === "compress") {
      const out = await resavePdf(bufs[0]);
      await writeFile(resolve(dir, "out.pdf"), out);
      return NextResponse.json({ id, filename: pdfOutName(base, "-tidied.pdf"), kind: "pdf" });
    }
    if (mode === "split") {
      const spec = String(form.get("ranges") ?? "");
      const single = String(form.get("single") ?? "") === "true";
      const count = await pageCount(bufs[0]);
      const ranges = parsePageRanges(spec, count); // throws readable errors
      const parts = await splitPdf(bufs[0], ranges, { single });
      if (single) {
        await writeFile(resolve(dir, "out.pdf"), parts[0].data);
        return NextResponse.json({ id, filename: pdfOutName(base, "-selected.pdf"), kind: "pdf" });
      }
      const zip = await zipFiles(parts);
      await writeFile(resolve(dir, "out.zip"), zip);
      return NextResponse.json({ id, filename: pdfOutName(base, "-split.zip"), kind: "zip" });
    }
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (err) {
    try { await cleanupJob("pdf", id); } catch { /* best-effort */ }
    // Page-range errors are user-facing 400s; everything else is a 500.
    const msg = err instanceof Error ? err.message : String(err);
    const status = /page|range|out of range/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
```

- [ ] **Step 7: Implement the download route**

`packages/web/app/api/pdf/file/[id]/route.ts` — read `out.pdf` or `out.zip` based on `url.searchParams.get("kind")` (`zip` → `application/zip`, else `application/pdf`), filename from `safeBase(name)` (keep the given extension in the name). Same try/404 shape as HEIC's `[id]`.

- [ ] **Step 8: Implement page + client**

`page.tsx`: `<h1>Merge, split, or shrink PDFs</h1>` + `<PdfClient />`.
`PdfClient.tsx`: a `Segmented` for mode (`merge | split | compress`). Per mode:
- **merge**: `<input type="file" multiple accept="application/pdf">`, a reorderable list of picked names (drag or up/down buttons — reuse the settings GroupManager pointer-reorder approach if handy, else simple ↑/↓ buttons), one POST with all files appended as `file`.
- **split**: single-file input, a text `field` for ranges (placeholder "1-3, 5, 8-10"), a checkbox "Combine into one PDF instead of separate files" (`single`). POST `{ file, ranges, single }`. Surface a 400 error message inline in `text-danger`.
- **compress**: single-file input, helper copy: "Tidies the file structure. It won't shrink image-heavy PDFs." POST `{ file }`.
On success, show a download `<a href={`/api/pdf/file/${id}?name=${encodeURIComponent(filename)}&kind=${kind}`} download>`.

- [ ] **Step 9: Manual smoke + commit**

Merge two PDFs; split one by "1-2, 3"; compress one. Confirm outputs open and the split zip contains two PDFs.
```bash
git add packages/core/src/pdf.ts packages/core/test/pdf.test.ts packages/core/package.json packages/web/lib/pdf.ts packages/web/app/api/pdf packages/web/app/pdf
git commit -m "feat(tools): PDF merge, split, and structural compress"
```

---

## Task 5: Video compression tool (`video`)

**Files:**
- Create: `packages/core/src/video.ts` + `packages/core/test/video.test.ts`
- Create: `packages/web/lib/video.ts`
- Create: `packages/web/app/api/video/route.ts` + `packages/web/app/api/video/[id]/route.ts`
- Create: `packages/web/app/video/page.tsx` + `packages/web/app/video/VideoClient.tsx`
- Modify: `packages/core/package.json` (`"./video"` export)

**Interfaces:**
- Consumes: `@/lib/jobs`; `run`, `ffmpegBin` from `@/lib/spawn`; `swapExt` from core names.
- Produces (core): `type VideoPreset = "smaller" | "balanced" | "quality"`; `type VideoScale = "keep" | "1080" | "720"`; `crfForPreset(p): number` (28/23/20); `ffmpegCompressArgs(inPath, outPath, opts: { crf: number; scale: VideoScale }): string[]`; `videoOutName(srcName): string` (→ `<base>-compressed.mp4`).
- Produces (lib): `compressVideo(inPath, outPath, opts): Promise<void>`.
- Produces (route): POST `/api/video` form `{ file, preset, scale }` → `{ id, filename, bytesIn, bytesOut }`; GET `/api/video/[id]?name=`.

- [ ] **Step 1: Write the failing core test**

`packages/core/test/video.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { crfForPreset, ffmpegCompressArgs, videoOutName } from "../src/video.js";

describe("crfForPreset", () => {
  it("maps presets to CRF", () => {
    expect(crfForPreset("smaller")).toBe(28);
    expect(crfForPreset("balanced")).toBe(23);
    expect(crfForPreset("quality")).toBe(20);
  });
});

describe("ffmpegCompressArgs", () => {
  it("builds an h264 + aac mp4 command with the given crf", () => {
    const a = ffmpegCompressArgs("in.mov", "out.mp4", { crf: 23, scale: "keep" });
    expect(a).toContain("-i");
    expect(a[a.indexOf("-i") + 1]).toBe("in.mov");
    expect(a).toContain("libx264");
    expect(a).toContain("23");
    expect(a).toContain("aac");
    expect(a[a.length - 1]).toBe("out.mp4");
    expect(a).toContain("-y");
    expect(a.join(" ")).not.toContain("scale="); // keep => no scale filter
  });
  it("adds a scale filter for 720", () => {
    const a = ffmpegCompressArgs("in.mp4", "out.mp4", { crf: 28, scale: "720" });
    expect(a.join(" ")).toContain("scale=-2:720");
  });
});

describe("videoOutName", () => {
  it("names the output mp4", () => {
    expect(videoOutName("Clip.MOV")).toBe("Clip-compressed.mp4");
  });
});
```

- [ ] **Step 2: Run it, verify fail**

Run: `cd packages/core && npx vitest run test/video.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `core/src/video.ts`**

```typescript
import { safeBase } from "./names.js";

export type VideoPreset = "smaller" | "balanced" | "quality";
export type VideoScale = "keep" | "1080" | "720";

export function crfForPreset(p: VideoPreset): number {
  return p === "smaller" ? 28 : p === "quality" ? 20 : 23;
}

export function ffmpegCompressArgs(
  inPath: string,
  outPath: string,
  opts: { crf: number; scale: VideoScale },
): string[] {
  const args = ["-y", "-i", inPath];
  if (opts.scale !== "keep") {
    // -2 keeps the other dimension even, required by h264.
    args.push("-vf", `scale=-2:${opts.scale}`);
  }
  args.push(
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", String(opts.crf),
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outPath,
  );
  return args;
}

export function videoOutName(srcName: string): string {
  const base = safeBase(srcName.replace(/\.[a-z0-9]+$/i, "")) || "video";
  return `${base}-compressed.mp4`;
}
```

- [ ] **Step 4: Add export, build, verify pass**

Add `"./video": "./dist/video.js"`. Run: `cd packages/core && npm run build && npx vitest run test/video.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `lib/video.ts`**

```typescript
import { run, ffmpegBin } from "@/lib/spawn";
import { ffmpegCompressArgs, type VideoScale } from "@event-editor/core/video";

export async function compressVideo(
  inPath: string,
  outPath: string,
  opts: { crf: number; scale: VideoScale },
): Promise<void> {
  await run(ffmpegBin(), ffmpegCompressArgs(inPath, outPath, opts));
}
```

- [ ] **Step 6: Implement POST route**

`packages/web/app/api/video/route.ts` — mirror the resize route, but: write the upload to `resolve(dir, "source")`, derive `crf = crfForPreset(preset)` (guard `preset` to the three values, default `balanced`), guard `scale` to `keep|1080|720`, call `compressVideo(source, resolve(dir, "out.mp4"), { crf, scale })`, `stat` the output for `bytesOut`, return `{ id, filename: videoOutName(file.name), bytesIn, bytesOut }`. Same job-dir + sweep + cleanup-on-error scaffolding as HEIC. Import `crfForPreset, videoOutName` from `@event-editor/core/video`.

- [ ] **Step 7: Implement download route**

`packages/web/app/api/video/[id]/route.ts` — read `out.mp4`, `Content-Type: video/mp4`, filename `safeBase(name)`. Same shape as HEIC `[id]`.

- [ ] **Step 8: Implement page + client**

`page.tsx`: `<h1>Compress a video</h1>` + `<VideoClient />`.
`VideoClient.tsx` — single-file (`accept="video/*"`), a preset `Segmented` (`Smaller | Balanced | Best quality` → `smaller|balanced|quality`), a scale `Segmented` (`Keep | 1080p | 720p` → `keep|1080|720`). One `.btn.btn-accent` "Compress". While busy show a `Loader2` spinner and copy "This can take a while for long videos." On done, show `bytesIn → bytesOut` and a download `<a>`.

- [ ] **Step 9: Manual smoke + commit**

Compress a short mov at "Smaller"/720p, confirm the mp4 plays and is smaller.
```bash
git add packages/core/src/video.ts packages/core/test/video.test.ts packages/core/package.json packages/web/lib/video.ts packages/web/app/api/video packages/web/app/video
git commit -m "feat(tools): video compression"
```

---

## Task 6: Trim & join clips tool (`splice`)

**Files:**
- Create: `packages/core/src/splice.ts` + `packages/core/test/splice.test.ts`
- Create: `packages/web/lib/splice.ts`
- Create: `packages/web/app/api/splice/route.ts` + `packages/web/app/api/splice/[id]/route.ts`
- Create: `packages/web/app/splice/page.tsx` + `packages/web/app/splice/SpliceClient.tsx`
- Modify: `packages/core/package.json` (`"./splice"` export)

**Interfaces:**
- Consumes: `@/lib/jobs`; `run`, `ffmpegBin` from `@/lib/spawn`.
- Produces (core): `type SpliceKind = "video" | "audio"`; `type SpliceScale = "match" | "1080" | "720"`; `type Clip = { start: number; end: number; volume: number }` (seconds; volume 0–2, 1 = unchanged); `validateClips(clips: Clip[]): void` (throws if empty or any `start >= end` or `volume < 0`); `ffmpegSpliceArgs(inPaths: string[], outPath: string, clips: Clip[], opts: { kind: SpliceKind; scale: SpliceScale }): string[]`; `spliceOutName(kind: SpliceKind): string` (`joined.mp4` / `joined.m4a`).
- Produces (lib): `spliceClips(inPaths, outPath, clips, opts): Promise<void>`.
- Produces (route): POST `/api/splice` form: many `file` (order preserved) + `manifest` (JSON: `{ kind, scale, clips: Clip[] }`) → `{ id, filename }`; GET `/api/splice/[id]?name=&kind=`.

- [ ] **Step 1: Write the failing core test**

`packages/core/test/splice.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateClips, ffmpegSpliceArgs, spliceOutName } from "../src/splice.js";

const clips = [
  { start: 0, end: 5, volume: 1 },
  { start: 2, end: 4, volume: 0 },
];

describe("validateClips", () => {
  it("rejects an empty list", () => {
    expect(() => validateClips([])).toThrow(/at least one/i);
  });
  it("rejects start >= end", () => {
    expect(() => validateClips([{ start: 3, end: 3, volume: 1 }])).toThrow(/trim/i);
  });
});

describe("ffmpegSpliceArgs (video)", () => {
  it("trims, scales, and concats each input", () => {
    const a = ffmpegSpliceArgs(["a.mp4", "b.mp4"], "out.mp4", clips, { kind: "video", scale: "720" });
    const s = a.join(" ");
    expect(a.filter((x) => x === "-i").length).toBe(2);
    expect(s).toContain("trim=start=0:end=5");
    expect(s).toContain("trim=start=2:end=4");
    expect(s).toContain("scale=-2:720");
    expect(s).toContain("volume=0"); // muted second clip
    expect(s).toContain("concat=n=2:v=1:a=1");
    expect(a[a.length - 1]).toBe("out.mp4");
  });
});

describe("ffmpegSpliceArgs (audio)", () => {
  it("uses atrim and audio-only concat", () => {
    const a = ffmpegSpliceArgs(["a.mp3", "b.mp3"], "out.m4a", clips, { kind: "audio", scale: "match" });
    const s = a.join(" ");
    expect(s).toContain("atrim=start=0:end=5");
    expect(s).toContain("concat=n=2:v=0:a=1");
    expect(s).not.toContain("scale=");
  });
});

describe("spliceOutName", () => {
  it("names by kind", () => {
    expect(spliceOutName("video")).toBe("joined.mp4");
    expect(spliceOutName("audio")).toBe("joined.m4a");
  });
});
```

- [ ] **Step 2: Run it, verify fail**

Run: `cd packages/core && npx vitest run test/splice.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `core/src/splice.ts`**

```typescript
export type SpliceKind = "video" | "audio";
export type SpliceScale = "match" | "1080" | "720";
export type Clip = { start: number; end: number; volume: number };

export function validateClips(clips: Clip[]): void {
  if (!clips || clips.length === 0) throw new Error("Add at least one clip");
  for (const c of clips) {
    if (!(c.end > c.start)) throw new Error("Each clip's trim must end after it starts");
    if (c.volume < 0) throw new Error("Volume cannot be negative");
  }
}

// Build one filter_complex that trims (and for video, scales) each input, then
// concats them. Video streams normalise to the chosen scale so mismatched
// sources join cleanly; audio uses atrim + volume.
export function ffmpegSpliceArgs(
  inPaths: string[],
  outPath: string,
  clips: Clip[],
  opts: { kind: SpliceKind; scale: SpliceScale },
): string[] {
  validateClips(clips);
  const args: string[] = ["-y"];
  for (const p of inPaths) args.push("-i", p);

  const n = inPaths.length;
  const parts: string[] = [];
  const labels: string[] = [];

  for (let i = 0; i < n; i++) {
    const c = clips[i];
    if (opts.kind === "video") {
      const scaleFilter = opts.scale === "match" ? "" : `,scale=-2:${opts.scale}`;
      parts.push(
        `[${i}:v]trim=start=${c.start}:end=${c.end},setpts=PTS-STARTPTS${scaleFilter}[v${i}]`,
      );
      parts.push(
        `[${i}:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,volume=${c.volume}[a${i}]`,
      );
      labels.push(`[v${i}][a${i}]`);
    } else {
      parts.push(
        `[${i}:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,volume=${c.volume}[a${i}]`,
      );
      labels.push(`[a${i}]`);
    }
  }

  const v = opts.kind === "video" ? 1 : 0;
  const concat = `${labels.join("")}concat=n=${n}:v=${v}:a=1[outv][outa]`;
  const filter = `${parts.join(";")};${concat}`.replace("[outv][outa]", opts.kind === "video" ? "[outv][outa]" : "[outa]");

  args.push("-filter_complex", filter);
  if (opts.kind === "video") {
    args.push("-map", "[outv]", "-map", "[outa]", "-c:v", "libx264", "-preset", "medium", "-crf", "20");
    args.push("-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart");
  } else {
    args.push("-map", "[outa]", "-c:a", "aac", "-b:a", "192k");
  }
  args.push(outPath);
  return args;
}

export function spliceOutName(kind: SpliceKind): string {
  return kind === "video" ? "joined.mp4" : "joined.m4a";
}
```

Note: for the audio branch the concat produces a single `[outa]` (v=0). The `.replace` above collapses the video-only `[outv][outa]` tail to `[outa]` for audio. Verify the test's `concat=n=2:v=0:a=1` assertion passes; if the label bookkeeping is off, adjust so audio concat ends `...concat=n=N:v=0:a=1[outa]` and video ends `...:v=1:a=1[outv][outa]`.

- [ ] **Step 4: Add export, build, verify pass**

Add `"./splice": "./dist/splice.js"`. Run: `cd packages/core && npm run build && npx vitest run test/splice.test.ts`
Expected: PASS. Fix filtergraph label bookkeeping if any assertion fails.

- [ ] **Step 5: Implement `lib/splice.ts`**

```typescript
import { run, ffmpegBin } from "@/lib/spawn";
import { ffmpegSpliceArgs, type Clip, type SpliceKind, type SpliceScale } from "@event-editor/core/splice";

export async function spliceClips(
  inPaths: string[],
  outPath: string,
  clips: Clip[],
  opts: { kind: SpliceKind; scale: SpliceScale },
): Promise<void> {
  await run(ffmpegBin(), ffmpegSpliceArgs(inPaths, outPath, clips, opts));
}
```

- [ ] **Step 6: Implement POST route**

`packages/web/app/api/splice/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newJobId, jobDir, cleanupJob, sweepOldJobs } from "@/lib/jobs";
import { validateClips, spliceOutName, type Clip, type SpliceKind, type SpliceScale } from "@event-editor/core/splice";
import { spliceClips } from "@/lib/splice";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Add at least one clip" }, { status: 400 });

  let manifest: { kind: SpliceKind; scale: SpliceScale; clips: Clip[] };
  try {
    manifest = JSON.parse(String(form.get("manifest") ?? ""));
    validateClips(manifest.clips);
    if (manifest.clips.length !== files.length) throw new Error("Clip settings do not match the files");
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Bad request" }, { status: 400 });
  }
  const kind: SpliceKind = manifest.kind === "audio" ? "audio" : "video";
  const scale: SpliceScale = manifest.scale === "1080" || manifest.scale === "720" ? manifest.scale : "match";
  const ext = kind === "video" ? "mp4" : "m4a";

  const id = newJobId();
  const dir = jobDir("splice", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("splice", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    const inPaths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const p = resolve(dir, `source-${i}`);
      await writeFile(p, Buffer.from(await files[i].arrayBuffer()));
      inPaths.push(p);
    }
    await spliceClips(inPaths, resolve(dir, `out.${ext}`), manifest.clips, { kind, scale });
    return NextResponse.json({ id, filename: spliceOutName(kind), kind });
  } catch (err) {
    try { await cleanupJob("splice", id); } catch { /* best-effort */ }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 7: Implement download route**

`packages/web/app/api/splice/[id]/route.ts` — read `out.mp4` or `out.m4a` based on `kind` searchparam (`audio` → `out.m4a` + `audio/mp4`, else `out.mp4` + `video/mp4`). Same 404 shape.

- [ ] **Step 8: Implement page + client**

`page.tsx`: `<h1>Trim and join clips</h1>` + `<SpliceClient />`.
`SpliceClient.tsx` — the richest client. Structure:
- State: `kind: "video" | "audio" | null` (null until first file locks it), `scale`, and `clips: { key; file: File; url: string; name; duration: number; start: number; end: number; volume: number }[]`.
- File input `accept="video/*,audio/*"` multiple. On pick: for each file, infer type from `file.type` (`startsWith("video")` → video else audio). **Type-lock**: if `kind` is null, set it from the first file; reject (with a `text-danger` message) any picked file whose type disagrees with `kind`. Create `url = URL.createObjectURL(file)` and read duration by loading a hidden `<video>`/`<audio>` (`el.preload = "metadata"; el.onloadedmetadata = () => setDuration(el.duration)`). Default `start = 0`, `end = duration`, `volume = 1`.
- Per clip row: an inline `<video controls>`/`<audio controls>` with `src={url}`; a dual-range trim control (two `<input type="range" min={0} max={duration} step={0.1}>` for start/end, guarded so `start < end`); a volume range (0–2 step 0.05, shown as %); a mute toggle (sets volume 0, restores to 1); ↑/↓ reorder buttons; a remove button (also `URL.revokeObjectURL`). Show the trimmed length (`end - start`).
- A "Join clips" `.btn.btn-accent` → build `manifest = { kind, scale, clips: clips.map(c => ({ start: c.start, end: c.end, volume: c.volume })) }`, append every `file` in order + `manifest` (JSON string) to FormData, POST `/api/splice`. On done, download `<a href={`/api/splice/${id}?name=${encodeURIComponent(filename)}&kind=${kind}`} download>`.
- Show the scale `Segmented` (`Match first | 1080p | 720p`) only when `kind === "video"`.
- Clean up object URLs on unmount (`useEffect` return).

- [ ] **Step 9: Manual smoke + commit**

Two short mp4s: trim each, reorder, mute one, join — confirm one mp4 in the right order with the trims. Then two mp3s → one m4a.
```bash
git add packages/core/src/splice.ts packages/core/test/splice.test.ts packages/core/package.json packages/web/lib/splice.ts packages/web/app/api/splice packages/web/app/splice
git commit -m "feat(tools): trim and join clips (video or audio)"
```

---

## Task 7: QR generator tool (`qr`)

**Files:**
- Create: `packages/core/src/qr.ts` + `packages/core/test/qr.test.ts`
- Create: `packages/web/app/qr/page.tsx` + `packages/web/app/qr/QrClient.tsx`
- Modify: `packages/core/package.json` (`"./qr"` export)
- Add dep: `qrcode`, `@types/qrcode` (in `packages/web`)

**Interfaces:**
- Consumes: `qrcode` (browser build) in the client.
- Produces (core): `type QrEcc = "L" | "M" | "Q" | "H"`; `type QrFormat = "png" | "svg"`; `normalizeQrOpts(raw): { size: number; ecc: QrEcc; fg: string; bg: string; format: QrFormat }` (size clamp 128–1024 default 512; ecc guard default `M`; fg/bg validated as `#rrggbb`, defaults `#000000` / `#ffffff`; format guard default `png`).
- No route, no `[id]`, no job dir. Fully client-side.

- [ ] **Step 1: Install qrcode**

Run: `cd packages/web && npm install qrcode && npm install -D @types/qrcode`

- [ ] **Step 2: Write the failing core test**

`packages/core/test/qr.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeQrOpts } from "../src/qr.js";

describe("normalizeQrOpts", () => {
  it("applies defaults", () => {
    expect(normalizeQrOpts({})).toEqual({
      size: 512, ecc: "M", fg: "#000000", bg: "#ffffff", format: "png",
    });
  });
  it("clamps size", () => {
    expect(normalizeQrOpts({ size: 10 }).size).toBe(128);
    expect(normalizeQrOpts({ size: 9999 }).size).toBe(1024);
  });
  it("guards ecc and format", () => {
    expect(normalizeQrOpts({ ecc: "Z" as never }).ecc).toBe("M");
    expect(normalizeQrOpts({ ecc: "H" }).ecc).toBe("H");
    expect(normalizeQrOpts({ format: "gif" }).format).toBe("png");
  });
  it("rejects malformed hex colours", () => {
    expect(normalizeQrOpts({ fg: "red" }).fg).toBe("#000000");
    expect(normalizeQrOpts({ fg: "#123abc" }).fg).toBe("#123abc");
  });
});
```

- [ ] **Step 3: Run it, verify fail**

Run: `cd packages/core && npx vitest run test/qr.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `core/src/qr.ts`**

```typescript
export type QrEcc = "L" | "M" | "Q" | "H";
export type QrFormat = "png" | "svg";

function hexOr(v: unknown, fallback: string): string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}

export function normalizeQrOpts(raw: {
  size?: unknown; ecc?: string; fg?: unknown; bg?: unknown; format?: string;
}): { size: number; ecc: QrEcc; fg: string; bg: string; format: QrFormat } {
  const s = Number.isFinite(Number(raw.size)) ? Math.round(Number(raw.size)) : 512;
  const ecc: QrEcc =
    raw.ecc === "L" || raw.ecc === "Q" || raw.ecc === "H" ? raw.ecc : "M";
  const format: QrFormat = raw.format === "svg" ? "svg" : "png";
  return {
    size: Math.min(1024, Math.max(128, s)),
    ecc,
    fg: hexOr(raw.fg, "#000000"),
    bg: hexOr(raw.bg, "#ffffff"),
    format,
  };
}
```

- [ ] **Step 5: Add export, build, verify pass**

Add `"./qr": "./dist/qr.js"`. Run: `cd packages/core && npm run build && npx vitest run test/qr.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement page + client**

`page.tsx`: `<h1>Make a QR code</h1>` + `<QrClient />`.
`QrClient.tsx` (`"use client"`):
- State from `normalizeQrOpts` fields plus `text: string`.
- Inputs: a text/URL `field`; size range (128–1024); ecc `Segmented` (`L|M|Q|H`); two `<input type="color">` for fg/bg; a format `Segmented` (`PNG | SVG`).
- Live preview: on any change with non-empty `text`, call `import QRCode from "qrcode"` — for PNG `QRCode.toDataURL(text, { width: size, errorCorrectionLevel: ecc, color: { dark: fg, light: bg } })` into an `<img src={dataUrl}>`; for SVG `QRCode.toString(text, { type: "svg", width: size, errorCorrectionLevel: ecc, color: { dark: fg, light: bg } })` and render via `dangerouslySetInnerHTML` inside a bounded box.
- Download: PNG → `<a href={dataUrl} download="qr.png">`; SVG → build a `Blob([svg], { type: "image/svg+xml" })`, `URL.createObjectURL`, `<a download="qr.svg">` (revoke on cleanup).
- Empty `text` → show a muted placeholder, no preview. All computation client-side; no fetch.

- [ ] **Step 7: Manual smoke + commit**

Enter a URL, tweak colours + ecc, download PNG and SVG, scan the PNG with a phone.
```bash
git add packages/core/src/qr.ts packages/core/test/qr.test.ts packages/core/package.json packages/web/app/qr packages/web/package.json packages/web/package-lock.json
git commit -m "feat(tools): client-side QR code generator"
```

---

## Task 8: Register all six tools + `utilities` group

**Files:**
- Modify: `packages/web/components/tools.ts` (import icons, add 6 `Tool` entries)
- Modify: `packages/web/components/tool-store.ts` (add `utilities` to the default group order + label)

**Interfaces:**
- Consumes: the `Tool` type already in `tools.ts`; the default-group machinery in `tool-store.ts`.

- [ ] **Step 1: Confirm the tool-store group defaults**

Read `packages/web/components/tool-store.ts` and locate the default group order + labels (e.g. `DEFAULT_GROUP_ORDER` and a labels map). Note the exact identifiers used for existing groups (`images`, `documents`, `media`, `events`). If the store derives groups from `TOOLS[].defaultGroups` automatically, adding a tool with `defaultGroups: ["utilities"]` may be enough — verify whether an explicit label/order entry is also required. Adjust the following steps to the real shape you find.

- [ ] **Step 2: Add the icon imports and six entries in `tools.ts`**

Extend the import from `lucide-react` with `FileImage, Shrink, Files, Film, Combine, QrCode`. Append to `TOOLS`:
```typescript
  {
    id: "heic",
    href: "/heic",
    title: "Convert HEIC photos",
    body: "Turn iPhone .heic photos into jpg or png you can use anywhere.",
    Icon: FileImage,
    defaultGroups: ["images"],
    tags: ["heic", "iphone", "jpg", "png", "photo", "image"],
  },
  {
    id: "resize",
    href: "/resize",
    title: "Compress or resize images",
    body: "Shrink an image's dimensions or file size, and change its format.",
    Icon: Shrink,
    defaultGroups: ["images"],
    tags: ["resize", "compress", "image", "shrink", "webp"],
  },
  {
    id: "pdf",
    href: "/pdf",
    title: "Merge, split, or shrink PDFs",
    body: "Combine PDFs, split one by page ranges, or tidy a bloated file.",
    Icon: Files,
    defaultGroups: ["documents"],
    tags: ["pdf", "merge", "split", "compress", "combine"],
  },
  {
    id: "video",
    href: "/video",
    title: "Compress a video",
    body: "Re-encode a video smaller with a simple quality preset.",
    Icon: Film,
    defaultGroups: ["media"],
    tags: ["video", "compress", "mp4", "shrink"],
  },
  {
    id: "splice",
    href: "/splice",
    title: "Trim and join clips",
    body: "Trim, reorder, and join video or audio clips into one file.",
    Icon: Combine,
    defaultGroups: ["media"],
    tags: ["video", "audio", "trim", "join", "concat", "edit"],
  },
  {
    id: "qr",
    href: "/qr",
    title: "Make a QR code",
    body: "Turn a link or text into a QR code you can download as png or svg.",
    Icon: QrCode,
    defaultGroups: ["utilities"],
    tags: ["qr", "code", "link", "url"],
  },
```

- [ ] **Step 3: Register the `utilities` group in `tool-store.ts`**

Following the shape found in Step 1, add `utilities` to the default group order (after `documents`/`media`, before any trailing catch-all) and give it the label `Utilities`. If groups are derived purely from `defaultGroups`, confirm the pill label falls back to a title-cased id; if not, add the explicit label.

- [ ] **Step 4: Typecheck + tests + build**

Run:
```bash
cd packages/core && npm run build
cd ../web && npx tsc --noEmit && npx vitest run && npm run build
```
Expected: tsc shows only the 5 pre-existing errors; vitest green (existing + new core tests via the core suite; web tests green); `next build` lists the new routes `/heic /resize /pdf /video /splice /qr` and their `/api/*` handlers.

- [ ] **Step 5: Live smoke of the shell**

Run the app. On the home grid, confirm 11 tool cards render, the new cards sit in the right groups, the `Utilities` pill appears with the QR card, and search finds each new tool by a tag (e.g. "heic", "trim", "qr"). Open each new route and confirm it loads without a client error.

- [ ] **Step 6: Commit**

```bash
git add packages/web/components/tools.ts packages/web/components/tool-store.ts
git commit -m "feat(tools): register 6 utility tools and the utilities group"
```

---

## Self-review notes (for the executor)

- **Filtergraph fragility (Task 6):** `ffmpegSpliceArgs` is the one place where the code and the test may disagree on exact label bookkeeping. Treat the test assertions (`concat=n=N:v=1:a=1` for video, `:v=0:a=1` for audio; per-clip `trim`/`atrim` + `volume`) as the contract and adjust the builder until green. The `.replace` shim in the draft is a smell — prefer building the correct concat tail directly per `kind` (video → `[outv][outa]`, audio → `[outa]`) rather than string-replacing.
- **Route slug collision (Task 4):** two different dynamic slugs (`[mode]` and `[id]`) cannot be siblings — that's why the plan nests them under `/process/[mode]` and `/file/[id]`. Do not flatten them back.
- **Core rebuild:** after every `core/src` change, `npm run build` in `packages/core` before the web app or its tests will see it.
- **heic-convert on the packaged app:** pure JS/wasm, ships inside the standalone server bundle — no asar concern.
- **No new packaging config needed** for sharp/ffmpeg (already resolved via `extraResources`).
