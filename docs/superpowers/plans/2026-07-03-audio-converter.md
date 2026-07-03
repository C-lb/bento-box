# Audio Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `/convert` tool that turns a media link (via yt-dlp) or an uploaded audio/video file (via ffmpeg) into a 192 kbps mp3 with an editable, prefilled filename, delivered as a browser download and an optional save to Google Drive.

**Architecture:** Pure, unit-tested helpers live in `packages/core/src/convert.ts` (filename sanitize, default-name derivation, yt-dlp/ffmpeg argv builders). Web-side binary detection, working-dir management, and process spawning live in `packages/web/lib/convert.ts`, mirroring the slicer's `lib/slice.ts` + `lib/pptx-convert.ts`. Thin Next.js route handlers under `app/api/convert/` orchestrate them; the page is `app/convert/` with a client component. This is a peer tool to sorter/transcriber/studio/slicer.

**Tech Stack:** TypeScript, Next.js App Router (Node runtime), Vitest, `yt-dlp` (required local binary), `ffmpeg` (already installed), existing Google Drive helpers.

## Global Constraints

- Monorepo: `@event-editor/core` (pure logic) + `@event-editor/web` (Next.js). Web imports core via **subpaths only** (e.g. `@event-editor/core/convert`), never deep relative paths.
- After ANY change to `packages/core/src`, rebuild core: `npm -w @event-editor/core run build`. Web will not see new core exports until this runs.
- Turbopack requires **extensionless** relative value imports inside web code; core ESM tests import siblings **with `.js`** (e.g. `../src/convert.js`).
- Core test files live in `packages/core/test/*.test.ts`; web tests live next to source as `*.test.ts`. Both run under `vitest run`.
- Encode target is **192 kbps mp3** for both modes.
- UI follows the anti-vibecode house standards: no eyebrow above the h1, sentence-case copy, no em dashes, one accent (the single primary "Convert" button), soft raised surfaces, full interaction states (hover / disabled / loading / success / error).
- **ffmpeg is bundled** with the app via the `ffmpeg-static` npm package (already a desktop `externals` entry; `packages/web/lib/audio.ts` uses it). The converter MUST use `ffmpeg-static` for the encode, never the system `ffmpeg`. So file mode needs zero user setup.
- **yt-dlp is NOT bundled.** It is resolved from (in order) `EE_YTDLP_PATH`, the managed bin dir (`EE_BIN_DIR`, where the in-app downloader writes it), then common install paths. Link mode is gated on its presence; file mode never depends on it.
- yt-dlp needs ffmpeg to post-process to mp3; always pass it `--ffmpeg-location <dir of ffmpeg-static>` so it uses the bundled ffmpeg, not a system one.
- **Writable paths must come from env, not cwd.** The packaged server is forked with no `cwd`, so `resolve("data/…")` points at a read-only location. Resolve the data root as `process.env.EE_DATA_DIR ?? "data"` (the desktop app sets `EE_DATA_DIR` to `<userData>/data`; dev falls back to the repo `data/`). Working files live under `<dataRoot>/convert/<id>/`, swept best-effort after 6 hours, cleaned on delivery. The managed bin dir is `process.env.EE_BIN_DIR ?? "<dataRoot>/bin"`.
- Route handlers set `export const runtime = "nodejs"` (they spawn processes and touch the filesystem).

---

### Task 1: Core pure helpers (`convert.ts`)

**Files:**
- Create: `packages/core/src/convert.ts`
- Modify: `packages/core/src/index.ts` (add export line)
- Modify: `packages/core/package.json` (add `"./convert"` to `exports`)
- Test: `packages/core/test/convert.test.ts`

**Interfaces:**
- Produces:
  - `sanitizeMp3Filename(raw: string): string` — returns a safe base name with exactly one trailing `.mp3`. Strips path separators and control/unsafe chars, collapses whitespace, trims, caps the base at 120 chars. Empty-after-sanitize returns `audio.mp3`.
  - `defaultNameFromSource(name: string): string` — strips a trailing extension from `name` and returns the sanitized base (no `.mp3` appended; the field shows a base, the sanitizer adds `.mp3` at submit). Empty returns `audio`.
  - `ytDlpTitleArgs(url: string): string[]` — argv for fetching the title.
  - `ytDlpExtractArgs(url: string, outStem: string, ffmpegLocation: string): string[]` — argv for extracting mp3 to `<outStem>.mp3`, telling yt-dlp to use the bundled ffmpeg at `ffmpegLocation` (a directory).
  - `ffmpegMp3Args(inPath: string, outPath: string): string[]` — argv for transcoding to 192 kbps mp3.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/convert.test.ts
import { describe, it, expect } from "vitest";
import {
  sanitizeMp3Filename,
  defaultNameFromSource,
  ytDlpTitleArgs,
  ytDlpExtractArgs,
  ffmpegMp3Args,
} from "../src/convert.js";

describe("sanitizeMp3Filename", () => {
  it("adds a single .mp3 extension", () => {
    expect(sanitizeMp3Filename("talk")).toBe("talk.mp3");
  });
  it("does not double the extension", () => {
    expect(sanitizeMp3Filename("talk.mp3")).toBe("talk.mp3");
  });
  it("strips path separators and unsafe characters", () => {
    expect(sanitizeMp3Filename("../a/b:c*?.mp3")).toBe("a_b_c.mp3");
  });
  it("collapses whitespace and trims", () => {
    expect(sanitizeMp3Filename("  my   talk  ")).toBe("my_talk.mp3");
  });
  it("falls back to audio.mp3 when empty after sanitize", () => {
    expect(sanitizeMp3Filename("///")).toBe("audio.mp3");
  });
  it("caps the base length at 120 chars", () => {
    const long = "x".repeat(200);
    const out = sanitizeMp3Filename(long);
    expect(out.endsWith(".mp3")).toBe(true);
    expect(out.length).toBe(124); // 120 + ".mp3"
  });
});

describe("defaultNameFromSource", () => {
  it("strips a trailing extension", () => {
    expect(defaultNameFromSource("keynote.mov")).toBe("keynote");
  });
  it("sanitizes unsafe characters", () => {
    expect(defaultNameFromSource("a b/c.mp4")).toBe("a_b_c");
  });
  it("returns audio for an empty name", () => {
    expect(defaultNameFromSource("")).toBe("audio");
  });
});

describe("ytDlpTitleArgs", () => {
  it("prints the title for the url", () => {
    expect(ytDlpTitleArgs("https://x/y")).toEqual([
      "--no-playlist", "--print", "title", "https://x/y",
    ]);
  });
});

describe("ytDlpExtractArgs", () => {
  it("extracts a 192k mp3 to the given stem using the bundled ffmpeg", () => {
    expect(ytDlpExtractArgs("https://x/y", "/tmp/abc/out", "/opt/ff/bin")).toEqual([
      "--no-playlist", "-x", "--audio-format", "mp3", "--audio-quality", "192K",
      "--ffmpeg-location", "/opt/ff/bin",
      "-o", "/tmp/abc/out.%(ext)s", "https://x/y",
    ]);
  });
});

describe("ffmpegMp3Args", () => {
  it("strips video and encodes 192k mp3, overwriting", () => {
    expect(ffmpegMp3Args("/tmp/in.mov", "/tmp/out.mp3")).toEqual([
      "-y", "-i", "/tmp/in.mov", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "/tmp/out.mp3",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core exec vitest run test/convert.test.ts`
Expected: FAIL — cannot resolve `../src/convert.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/convert.ts

// Replace anything unsafe for a filename with an underscore, collapse runs,
// and trim leading/trailing separators. Callers strip the extension first.
function safeBase(raw: string): string {
  return raw
    .replace(/[\/\\]/g, "_")            // path separators
    .replace(/[^a-zA-Z0-9._-]+/g, "_")  // any other unsafe char -> _
    .replace(/_+/g, "_")                 // collapse runs
    .replace(/^[_.]+|[_.]+$/g, "")       // trim leading/trailing _ or .
    .slice(0, 120);
}

export function sanitizeMp3Filename(raw: string): string {
  // Drop a trailing .mp3 (case-insensitive) before sanitizing, re-add one after.
  const withoutExt = raw.replace(/\.mp3$/i, "");
  const base = safeBase(withoutExt);
  return `${base || "audio"}.mp3`;
}

export function defaultNameFromSource(name: string): string {
  const withoutExt = name.replace(/\.[a-z0-9]{1,5}$/i, "");
  const base = safeBase(withoutExt);
  return base || "audio";
}

export function ytDlpTitleArgs(url: string): string[] {
  return ["--no-playlist", "--print", "title", url];
}

export function ytDlpExtractArgs(url: string, outStem: string, ffmpegLocation: string): string[] {
  return [
    "--no-playlist", "-x", "--audio-format", "mp3", "--audio-quality", "192K",
    "--ffmpeg-location", ffmpegLocation,
    "-o", `${outStem}.%(ext)s`, url,
  ];
}

export function ffmpegMp3Args(inPath: string, outPath: string): string[] {
  return ["-y", "-i", inPath, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", outPath];
}
```

- [ ] **Step 4: Add the core export and subpath**

In `packages/core/src/index.ts`, add after the last export line:

```typescript
export * from "./convert.js";
```

In `packages/core/package.json`, add to the `exports` object:

```json
"./convert": "./dist/convert.js",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm -w @event-editor/core exec vitest run test/convert.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Rebuild core**

Run: `npm -w @event-editor/core run build`
Expected: exits 0, `packages/core/dist/convert.js` exists.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/convert.ts packages/core/src/index.ts packages/core/package.json packages/core/test/convert.test.ts
git commit -m "feat(convert): core filename + yt-dlp/ffmpeg arg helpers"
```

---

### Task 2: Web lib — binary detection, working dir, exec (`lib/convert.ts`)

**Files:**
- Create: `packages/web/lib/convert.ts`
- Test: `packages/web/lib/convert.test.ts`

**Interfaces:**
- Consumes: `ytDlpTitleArgs`, `ytDlpExtractArgs`, `ffmpegMp3Args` from `@event-editor/core/convert`; `ffmpeg-static` (default export: the bundled ffmpeg path).
- Produces:
  - `ytDlpCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[]` — pure; ordered on-disk candidate paths for yt-dlp: `EE_YTDLP_PATH` override, then the managed bin path (`EE_BIN_DIR` or `<dataRoot>/bin`), then common install locations. All are real paths (no bare-name fallback — link mode requires a resolvable binary).
  - `resolveExisting(candidates: string[], exists: (p: string) => boolean): string | null` — pure; first existing candidate, else null.
  - `dataRoot(): string` — `process.env.EE_DATA_DIR ?? "data"`.
  - `binDir(): string` — `process.env.EE_BIN_DIR ?? resolve(dataRoot(), "bin")`.
  - `managedYtDlpPath(platform?): string` — `<binDir>/yt-dlp` (`yt-dlp.exe` on win32).
  - `ytDlpBin(): string | null` and `hasYtDlp(): boolean`
  - `ffmpegDir(): string` — the directory containing the bundled ffmpeg (`dirname(ffmpeg-static path)`), for yt-dlp's `--ffmpeg-location`.
  - `sanitizeConvertId(id: string): string`, `newConvertId(): string`, `convertDir(id: string): string`, `mp3Path(id: string): string`
  - `cleanupConvert(id: string): Promise<void>`, `sweepOldConverts(maxAgeMs: number): Promise<void>`
  - `fetchTitle(url: string): Promise<string>` — runs yt-dlp title, returns first non-empty line.
  - `extractFromUrl(url: string, id: string): Promise<void>` — runs yt-dlp extract (with `--ffmpeg-location ffmpegDir()`); result at `mp3Path(id)`.
  - `transcodeToMp3(inPath: string, id: string): Promise<void>` — runs the bundled ffmpeg; result at `mp3Path(id)`.

- [ ] **Step 1: Write the failing test (pure helpers only)**

```typescript
// packages/web/lib/convert.test.ts
import { describe, it, expect } from "vitest";
import { ytDlpCandidates, resolveExisting, sanitizeConvertId } from "./convert";

describe("ytDlpCandidates", () => {
  it("puts an explicit override first", () => {
    const c = ytDlpCandidates({ EE_YTDLP_PATH: "/opt/yt-dlp" }, "darwin");
    expect(c[0]).toBe("/opt/yt-dlp");
  });
  it("includes the managed bin path from EE_BIN_DIR", () => {
    const c = ytDlpCandidates({ EE_BIN_DIR: "/data/bin" }, "darwin");
    expect(c).toContain("/data/bin/yt-dlp");
  });
  it("uses yt-dlp.exe on win32", () => {
    const c = ytDlpCandidates({ EE_BIN_DIR: "C:/data/bin" }, "win32");
    expect(c).toContain("C:/data/bin/yt-dlp.exe");
  });
  it("includes a common homebrew install path", () => {
    const c = ytDlpCandidates({}, "darwin");
    expect(c).toContain("/opt/homebrew/bin/yt-dlp");
  });
  it("contains only real paths (no bare-name fallback)", () => {
    const c = ytDlpCandidates({}, "darwin");
    expect(c.every((p) => p.includes("/"))).toBe(true);
  });
});

describe("resolveExisting", () => {
  it("returns the first existing candidate", () => {
    expect(resolveExisting(["/a", "/b", "/c"], (p) => p === "/b")).toBe("/b");
  });
  it("returns null when none exist", () => {
    expect(resolveExisting(["/a", "/b"], () => false)).toBe(null);
  });
});

describe("sanitizeConvertId", () => {
  it("strips characters outside the id alphabet", () => {
    expect(sanitizeConvertId("../ab-9_x")).toBe("ab-9_x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web exec vitest run lib/convert.test.ts`
Expected: FAIL — module `./convert` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/web/lib/convert.ts
import { resolve, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { rm, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { ytDlpTitleArgs, ytDlpExtractArgs, ffmpegMp3Args } from "@event-editor/core/convert";

const COMMON = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

export function dataRoot(): string {
  return process.env.EE_DATA_DIR ?? "data";
}
export function binDir(): string {
  return process.env.EE_BIN_DIR ?? resolve(dataRoot(), "bin");
}
export function managedYtDlpPath(platform: NodeJS.Platform = process.platform): string {
  return join(binDir(), platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

// All candidates are real on-disk paths; link mode requires a resolvable binary,
// so there is no optimistic bare-name fallback.
export function ytDlpCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const exe = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const managed = env.EE_BIN_DIR
    ? join(env.EE_BIN_DIR, exe)
    : join(env.EE_DATA_DIR ?? "data", "bin", exe);
  const out: string[] = [];
  if (env.EE_YTDLP_PATH) out.push(env.EE_YTDLP_PATH);
  out.push(managed);
  for (const dir of COMMON) out.push(`${dir}/${exe}`);
  return out;
}

export function resolveExisting(candidates: string[], exists: (p: string) => boolean): string | null {
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

export function ytDlpBin(): string | null {
  return resolveExisting(ytDlpCandidates(process.env, process.platform), existsSync);
}
export function hasYtDlp(): boolean {
  return ytDlpBin() !== null;
}
export function ffmpegDir(): string {
  if (!ffmpegPath) throw new Error("bundled ffmpeg not found");
  return dirname(ffmpegPath);
}

export function sanitizeConvertId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}
export function newConvertId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}
export function convertDir(id: string): string {
  return resolve(dataRoot(), "convert", sanitizeConvertId(id));
}
export function mp3Path(id: string): string {
  return resolve(convertDir(id), "out.mp3");
}
export async function cleanupConvert(id: string): Promise<void> {
  await rm(convertDir(id), { recursive: true, force: true });
}
export async function sweepOldConverts(maxAgeMs: number): Promise<void> {
  const root = resolve(dataRoot(), "convert");
  let entries: string[];
  try { entries = await readdir(root); } catch { return; }
  const now = Date.now();
  for (const name of entries) {
    const p = resolve(root, name);
    try {
      const s = await stat(p);
      if (s.isDirectory() && now - s.mtimeMs > maxAgeMs) await rm(p, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const proc = spawn(bin, args);
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", rej);
    proc.on("close", (code) => (code === 0 ? res(out) : rej(new Error(err.trim() || `${bin} exited ${code}`))));
  });
}

export async function fetchTitle(url: string): Promise<string> {
  const bin = ytDlpBin();
  if (!bin) throw new Error("yt-dlp is not installed");
  const out = await run(bin, ytDlpTitleArgs(url));
  return out.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

export async function extractFromUrl(url: string, id: string): Promise<void> {
  const bin = ytDlpBin();
  if (!bin) throw new Error("yt-dlp is not installed");
  // yt-dlp writes <stem>.mp3; stem is the mp3 path without the extension.
  const stem = mp3Path(id).replace(/\.mp3$/, "");
  await run(bin, ytDlpExtractArgs(url, stem, ffmpegDir()));
}

export async function transcodeToMp3(inPath: string, id: string): Promise<void> {
  if (!ffmpegPath) throw new Error("bundled ffmpeg not found");
  await run(ffmpegPath, ffmpegMp3Args(inPath, mp3Path(id)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @event-editor/web exec vitest run lib/convert.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/convert.ts packages/web/lib/convert.test.ts
git commit -m "feat(convert): web binary detection, working dir, spawn helpers"
```

---

### Task 3: Link pipeline routes — title + url

**Files:**
- Create: `packages/web/app/api/convert/title/route.ts`
- Create: `packages/web/app/api/convert/url/route.ts`

**Interfaces:**
- Consumes: `hasYtDlp`, `fetchTitle`, `newConvertId`, `convertDir`, `extractFromUrl`, `cleanupConvert`, `sweepOldConverts`, `mp3Path` from `@/lib/convert`; `defaultNameFromSource`, `sanitizeMp3Filename` from `@event-editor/core/convert`.
- Produces:
  - `POST /api/convert/title` — `{ url }` → `{ title }` (default base name, no extension) or `{ error }`.
  - `POST /api/convert/url` — `{ url, filename? }` → `{ id, filename }` (filename includes `.mp3`) or `{ error }`.

- [ ] **Step 1: Write the title route**

```typescript
// packages/web/app/api/convert/title/route.ts
import { NextResponse } from "next/server";
import { hasYtDlp, fetchTitle } from "@/lib/convert";
import { defaultNameFromSource } from "@event-editor/core/convert";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasYtDlp()) {
    return NextResponse.json({ error: "yt-dlp is not installed" }, { status: 400 });
  }
  const { url } = (await request.json()) as { url?: string };
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 });
  }
  try {
    const raw = await fetchTitle(url);
    return NextResponse.json({ title: defaultNameFromSource(raw || "audio") });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the url route**

```typescript
// packages/web/app/api/convert/url/route.ts
import { NextResponse } from "next/server";
import { mkdir } from "node:fs/promises";
import { hasYtDlp, newConvertId, convertDir, extractFromUrl, cleanupConvert, sweepOldConverts } from "@/lib/convert";
import { sanitizeMp3Filename } from "@event-editor/core/convert";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasYtDlp()) {
    return NextResponse.json({ error: "yt-dlp is not installed. See the tool page for install steps." }, { status: 400 });
  }
  const { url, filename } = (await request.json()) as { url?: string; filename?: string };
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 });
  }
  const name = sanitizeMp3Filename(filename && filename.trim() ? filename : "audio");

  const id = newConvertId();
  await mkdir(convertDir(id), { recursive: true });
  try { await sweepOldConverts(6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    await extractFromUrl(url, id);
    return NextResponse.json({ id, filename: name });
  } catch (err) {
    try { await cleanupConvert(id); } catch { /* best-effort */ }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify (manual smoke, requires yt-dlp installed)**

Run in one terminal: `npm -w @event-editor/web run dev`
Then:
```bash
curl -s -X POST localhost:3000/api/convert/title -H 'content-type: application/json' -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```
Expected: JSON with a non-empty `title`. (If yt-dlp is not installed, expect `{"error":"yt-dlp is not installed"}` and a 400 — that is also correct behavior.)

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/api/convert/title/route.ts packages/web/app/api/convert/url/route.ts
git commit -m "feat(convert): title-prefill and url->mp3 routes"
```

---

### Task 4: File pipeline route — upload → mp3

**Files:**
- Create: `packages/web/app/api/convert/file/route.ts`

**Interfaces:**
- Consumes: `newConvertId`, `convertDir`, `transcodeToMp3`, `cleanupConvert`, `sweepOldConverts` from `@/lib/convert`; `sanitizeMp3Filename`, `defaultNameFromSource` from `@event-editor/core/convert`.
- Produces: `POST /api/convert/file` (multipart, field `file`, optional field `filename`) → `{ id, filename }` or `{ error }`.

- [ ] **Step 1: Write the route**

```typescript
// packages/web/app/api/convert/file/route.ts
import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newConvertId, convertDir, transcodeToMp3, cleanupConvert, sweepOldConverts } from "@/lib/convert";
import { sanitizeMp3Filename, defaultNameFromSource } from "@event-editor/core/convert";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const nameField = (form.get("filename") as string | null)?.trim();
  const name = sanitizeMp3Filename(nameField || defaultNameFromSource(file.name) || "audio");

  const id = newConvertId();
  const dir = convertDir(id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldConverts(6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  const inPath = resolve(dir, "source");
  try {
    await writeFile(inPath, Buffer.from(await file.arrayBuffer()));
    await transcodeToMp3(inPath, id);
    return NextResponse.json({ id, filename: name });
  } catch (err) {
    try { await cleanupConvert(id); } catch { /* best-effort */ }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify (manual smoke)**

With `npm -w @event-editor/web run dev` running and a small local `sample.m4a` (or any video):
```bash
curl -s -X POST localhost:3000/api/convert/file -F file=@sample.m4a -F filename="my clip"
```
Expected: `{"id":"...","filename":"my_clip.mp3"}` and `data/convert/<id>/out.mp3` exists.

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/api/convert/file/route.ts
git commit -m "feat(convert): file upload -> mp3 route"
```

---

### Task 5: Delivery routes — download + Drive save

**Files:**
- Create: `packages/web/app/api/convert/[id]/route.ts`
- Create: `packages/web/app/api/convert/drive-save/route.ts`
- Modify: `packages/web/lib/google/drive.ts` (add `uploadFile` to the interface and impl)

**Interfaces:**
- Consumes: `convertDir`, `mp3Path`, `sanitizeConvertId` from `@/lib/convert`; `sanitizeMp3Filename` from `@event-editor/core/convert`; `authedDriveClient`, `makeDriveClient`, `getDb` (as in `app/api/slice/drive-save/route.ts`).
- Produces:
  - `GET /api/convert/[id]?name=<file>.mp3` — streams `out.mp3` as an attachment.
  - `POST /api/convert/drive-save` — `{ id, filename, folderId }` → `{ url }`.
  - `DriveClient.uploadFile(name, bytes, mimeType, folderId): Promise<{ id; url }>`.

- [ ] **Step 1: Add `uploadFile` to the Drive client**

In `packages/web/lib/google/drive.ts`, add to the `DriveClient` interface (near `uploadPdf`):

```typescript
  uploadFile(name: string, bytes: Uint8Array, mimeType: string, folderId: string): Promise<{ id: string; url: string }>;
```

And add the implementation next to `uploadPdf`:

```typescript
    async uploadFile(name: string, bytes: Uint8Array, mimeType: string, folderId: string) {
      const res = await drive.files.create({
        requestBody: { name, parents: folderId ? [folderId] : undefined },
        media: { mimeType, body: Readable.from(Buffer.from(bytes)) },
        fields: "id, webViewLink",
      });
      const id = res.data.id;
      if (!id) throw new Error("Drive did not return a file id");
      return { id, url: res.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view` };
    },
```

- [ ] **Step 2: Write the download route**

```typescript
// packages/web/app/api/convert/[id]/route.ts
import { readFile } from "node:fs/promises";
import { mp3Path, sanitizeConvertId } from "@/lib/convert";
import { sanitizeMp3Filename } from "@event-editor/core/convert";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clean = sanitizeConvertId(id);
  const url = new URL(request.url);
  const name = sanitizeMp3Filename(url.searchParams.get("name") || "audio");
  try {
    const bytes = await readFile(mp3Path(clean));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
```

- [ ] **Step 3: Write the Drive-save route**

```typescript
// packages/web/app/api/convert/drive-save/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { mp3Path, sanitizeConvertId } from "@/lib/convert";
import { sanitizeMp3Filename } from "@event-editor/core/convert";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { id, filename, folderId } = (await request.json()) as { id?: string; filename?: string; folderId?: string };
    if (!id || !folderId) return NextResponse.json({ error: "id and folderId required" }, { status: 400 });
    const clean = sanitizeConvertId(id);
    const name = sanitizeMp3Filename(filename || "audio");

    const drive = await authedDriveClient(getDb());
    if (!drive) return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });

    const bytes = await readFile(mp3Path(clean));
    const res = await makeDriveClient(drive).uploadFile(name, new Uint8Array(bytes), "audio/mpeg", folderId);
    return NextResponse.json({ url: res.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify (manual smoke)**

After producing an id via Task 3/4, in a browser open `localhost:3000/api/convert/<id>?name=test.mp3` — it should download `test.mp3` and play. (Drive save is exercised end-to-end in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/google/drive.ts packages/web/app/api/convert/[id]/route.ts packages/web/app/api/convert/drive-save/route.ts
git commit -m "feat(convert): download stream + Drive save routes"
```

---

### Task 6: Page and client UI

**Files:**
- Create: `packages/web/app/convert/page.tsx`
- Create: `packages/web/app/convert/ConvertClient.tsx`

**Interfaces:**
- Consumes: `hasYtDlp` from `@/lib/convert` (server component gate); the five `/api/convert/*` routes.
- Produces: the `/convert` page. `page.tsx` is a server component that reads `hasYtDlp()` and passes it to `ConvertClient` as `ytDlp: boolean`.

Reference the slicer's page + client for the header layout, gate card, loading and error patterns, and the existing Drive folder picker usage (`app/slice/page.tsx`, `app/slice/SliceClient.tsx`). Reuse the existing Drive folder picker component the slicer uses for "Save to Drive" rather than building a new one.

- [ ] **Step 1: Write `page.tsx`**

```tsx
// packages/web/app/convert/page.tsx
import { hasYtDlp } from "@/lib/convert";
import { ConvertClient } from "./ConvertClient";

// Reads a runtime binary presence check; must not be statically prerendered.
export const dynamic = "force-dynamic";

export default function ConvertPage() {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Convert audio to mp3</h1>
        </div>
      </div>
      <ConvertClient ytDlp={hasYtDlp()} />
    </div>
  );
}
```

- [ ] **Step 2: Write `ConvertClient.tsx`**

Build a client component with:
- A segmented toggle: `From link` / `Upload file` (house segmented-control style; the two tools already using a similar control are the settings NavOrder and studio panels — match the neutral raised look).
- **From link mode:** a URL text input; on paste or blur (when the value looks like an http(s) URL) POST to `/api/convert/title` and set the filename field to the returned `title` (only if the user has not edited the filename yet). If `ytDlp` is false, replace this mode's body with a setup card: "Install yt-dlp to convert from links" and a code line `brew install yt-dlp`.
- **Upload file mode:** a file input with `accept="audio/*,video/*"` and a helper line: "Supports video (mp4, mov, mkv, webm, avi, m4v) and audio (mp3, wav, m4a, aac, flac, ogg)." On file select, set the filename field to `defaultNameFromSource(file.name)` if the user has not edited it. (Import `defaultNameFromSource` from `@event-editor/core/convert`.)
- A **Filename** text input (always visible, always editable). Show a small ".mp3" suffix hint next to it. Track an `edited` boolean so auto-prefill never clobbers a user edit.
- A single primary **Convert** button. On click: link mode POSTs `{ url, filename }` to `/api/convert/url`; file mode POSTs multipart (`file`, `filename`) to `/api/convert/file`. While pending, the button is disabled with a spinner and a status line ("Converting…"). On error, show a red inline message with the returned `error`.
- **Result panel** on success (`{ id, filename }`): show the filename and two actions:
  - **Download** — an anchor to `/api/convert/${id}?name=${encodeURIComponent(filename)}` with the `download` attribute.
  - **Save to Drive** — opens the existing Drive folder picker; on pick, POST `{ id, filename, folderId }` to `/api/convert/drive-save`, show a spinner, then a green success line linking the returned `url`. Handle its error state too.

Follow the anti-vibecode rules already in force in the sibling clients: one card with single padding, `btn`/`btn-accent` classes, focus rings, and no em dashes in copy. Keep all four+ interaction states on every button.

- [ ] **Step 3: Verify (manual, in the browser)**

With `npm -w @event-editor/web run dev`:
1. Visit `/convert`. Toggle both modes render.
2. File mode: pick a small video, confirm the filename prefills from the file name, edit it, click Convert, confirm the spinner then a Download that plays.
3. Link mode (if yt-dlp installed): paste a URL, confirm the filename prefills from the title, Convert, Download works. If yt-dlp absent, confirm the setup card shows instead.
4. Save to Drive: pick a folder, confirm success line with a working Drive link.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/convert/page.tsx packages/web/app/convert/ConvertClient.tsx
git commit -m "feat(convert): /convert page and client UI"
```

---

### Task 7: Wire into navigation, home, and settings

**Files:**
- Modify: `packages/web/components/nav-links.ts`
- Modify: `packages/web/app/page.tsx`
- Modify: `packages/web/components/tool-illustrations.tsx` (add `ConvertIllus`)

**Interfaces:**
- Produces: `/convert` appears in the sidebar and on the home grid. (Settings dependency status is added later, in Task 10.)

- [ ] **Step 1: Add the nav link**

In `packages/web/components/nav-links.ts`, import an icon (`AudioLines`) from `lucide-react` and add to `TOOL_LINKS`:

```typescript
{ href: "/convert", label: "Audio converter", Icon: AudioLines },
```

Add `AudioLines` to the existing `lucide-react` import line.

- [ ] **Step 2: Add the home card + illustration**

In `packages/web/components/tool-illustrations.tsx`, add a `ConvertIllus` component in the same visual style as `TranscribeIllus` (a simple SVG suggesting a link/file turning into a waveform). Then in `packages/web/app/page.tsx`, import `ConvertIllus` and `AudioLines`, and add a TOOLS entry:

```tsx
{
  href: "/convert",
  title: "Convert audio to mp3",
  body: "Turn a YouTube or video link, or an uploaded audio or video file, into an mp3 you can name and download.",
  illustration: <ConvertIllus />,
  Icon: AudioLines,
},
```

- [ ] **Step 3: Verify**

Run: `npm -w @event-editor/web run dev`
- Sidebar shows "Audio converter"; clicking it loads `/convert`.
- Home grid shows the new card; clicking it loads `/convert`.

- [ ] **Step 4: Run the full test + guard suite**

Run: `npm -w @event-editor/core run build && npm test`
Expected: all tests green (existing + the two new convert suites).

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/nav-links.ts packages/web/app/page.tsx packages/web/components/tool-illustrations.tsx
git commit -m "feat(convert): nav and home card"
```

---

# Part B — Managed dependencies

ffmpeg ships bundled (nothing to do). yt-dlp is fetched on demand by an in-app
downloader; LibreOffice is not auto-installed, only linked. This part adds the
desktop env wiring, the yt-dlp downloader, and a Settings "Dependencies" section.

---

### Task 8: Desktop env — data dir and bin dir

**Files:**
- Modify: `packages/desktop/main.js` (add `EE_DATA_DIR` and `EE_BIN_DIR` to `serverEnv()`)

**Interfaces:**
- Produces: the forked server sees `EE_DATA_DIR=<userData>/data` and `EE_BIN_DIR=<userData>/data/bin`, both on a writable disk, so `dataRoot()` / `binDir()` (Task 2) resolve correctly in the packaged app. Dev is unchanged (envs unset → `data/` fallback).

- [ ] **Step 1: Add the envs**

In `packages/desktop/main.js`, inside `serverEnv()`'s returned object (next to `EE_DB_PATH`), add:

```javascript
    EE_DATA_DIR: dataDir,
    EE_BIN_DIR: path.join(dataDir, "bin"),
```

The `dataDir` is already `mkdirSync`'d earlier in `serverEnv()`; the bin dir is created lazily by the downloader (Task 9), so no extra mkdir here.

- [ ] **Step 2: Verify (dev is unaffected)**

Run: `npm -w @event-editor/web run dev`
Expected: server boots; `dataRoot()` falls back to `data/` (envs unset in dev). No behavior change. (Packaged wiring is exercised when the desktop app is rebuilt, out of scope for this task's commit.)

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/main.js
git commit -m "feat(deps): pass writable data and bin dirs to the packaged server"
```

---

### Task 9: yt-dlp managed downloader (lib + route)

**Files:**
- Create: `packages/web/lib/deps.ts`
- Create: `packages/web/lib/deps.test.ts`
- Create: `packages/web/app/api/deps/ytdlp/route.ts`

**Interfaces:**
- Consumes: `binDir`, `managedYtDlpPath`, `hasYtDlp`, `ytDlpBin` from `@/lib/convert`; `findSoffice` from `@/lib/pptx-convert`; `ffmpeg-static`.
- Produces:
  - `ytDlpAsset(platform: NodeJS.Platform): string` — pure: `win32` -> `yt-dlp.exe`, `darwin` -> `yt-dlp_macos`, else `yt-dlp_linux`.
  - `ytDlpDownloadUrl(platform): string` — `https://github.com/yt-dlp/yt-dlp/releases/latest/download/<asset>`.
  - `downloadYtDlp(): Promise<{ version: string }>` — fetches the asset into `binDir()` at `managedYtDlpPath()`, `chmod 0o755`, then runs `--version` to confirm and returns it.
  - `ytDlpVersion(): Promise<string | null>` — runs the resolved yt-dlp `--version`, or null if absent.
  - `dependencyStatuses(): Promise<Dep[]>` where `Dep = { id: "ffmpeg" | "ytdlp" | "libreoffice"; label: string; ready: boolean; managed: boolean; version?: string; installUrl?: string; hint?: string }`.
  - `POST /api/deps/ytdlp` -> `{ version }` on success or `{ error }` (status 500).

- [ ] **Step 1: Write the failing test (pure helpers)**

```typescript
// packages/web/lib/deps.test.ts
import { describe, it, expect } from "vitest";
import { ytDlpAsset, ytDlpDownloadUrl } from "./deps";

describe("ytDlpAsset", () => {
  it("maps darwin to the macos build", () => {
    expect(ytDlpAsset("darwin")).toBe("yt-dlp_macos");
  });
  it("maps win32 to the exe", () => {
    expect(ytDlpAsset("win32")).toBe("yt-dlp.exe");
  });
  it("defaults to the linux build", () => {
    expect(ytDlpAsset("linux")).toBe("yt-dlp_linux");
  });
});

describe("ytDlpDownloadUrl", () => {
  it("points at the latest release asset", () => {
    expect(ytDlpDownloadUrl("darwin")).toBe(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web exec vitest run lib/deps.test.ts`
Expected: FAIL — module `./deps` not found.

- [ ] **Step 3: Write `deps.ts`**

```typescript
// packages/web/lib/deps.ts
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { binDir, managedYtDlpPath, ytDlpBin, hasYtDlp } from "./convert";
import { findSoffice } from "./pptx-convert";

export function ytDlpAsset(platform: NodeJS.Platform): string {
  if (platform === "win32") return "yt-dlp.exe";
  if (platform === "darwin") return "yt-dlp_macos";
  return "yt-dlp_linux";
}

export function ytDlpDownloadUrl(platform: NodeJS.Platform): string {
  return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpAsset(platform)}`;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const proc = spawn(bin, args);
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", rej);
    proc.on("close", (code) => (code === 0 ? res(out) : rej(new Error(err.trim() || `${bin} exited ${code}`))));
  });
}

export async function ytDlpVersion(): Promise<string | null> {
  const bin = ytDlpBin();
  if (!bin) return null;
  try { return (await run(bin, ["--version"])).trim(); } catch { return null; }
}

export async function downloadYtDlp(): Promise<{ version: string }> {
  const url = ytDlpDownloadUrl(process.platform);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await mkdir(binDir(), { recursive: true });
  const dest = managedYtDlpPath();
  await writeFile(dest, bytes);
  if (process.platform !== "win32") await chmod(dest, 0o755);
  const version = await ytDlpVersion();
  if (!version) throw new Error("Downloaded yt-dlp but it did not run. Try again.");
  return { version };
}

export interface Dep {
  id: "ffmpeg" | "ytdlp" | "libreoffice";
  label: string;
  ready: boolean;
  managed: boolean;      // true if the app can fetch/manage it in-app
  version?: string;
  installUrl?: string;   // for non-managed deps: where to download
  hint?: string;         // e.g. a brew command
}

export async function dependencyStatuses(): Promise<Dep[]> {
  const ytVersion = await ytDlpVersion();
  return [
    {
      id: "ffmpeg",
      label: "ffmpeg",
      ready: !!ffmpegPath,
      managed: false,
      hint: "Bundled with the app.",
    },
    {
      id: "ytdlp",
      label: "yt-dlp",
      ready: hasYtDlp(),
      managed: true,
      version: ytVersion ?? undefined,
    },
    {
      id: "libreoffice",
      label: "LibreOffice",
      ready: findSoffice() !== null,
      managed: false,
      installUrl: "https://www.libreoffice.org/download/download-libreoffice/",
      hint: "On Mac: brew install --cask libreoffice",
    },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @event-editor/web exec vitest run lib/deps.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the download route**

```typescript
// packages/web/app/api/deps/ytdlp/route.ts
import { NextResponse } from "next/server";
import { downloadYtDlp } from "@/lib/deps";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { version } = await downloadYtDlp();
    return NextResponse.json({ version });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 6: Verify (manual smoke)**

Temporarily move the brew yt-dlp aside so the managed path is exercised, or just run against a clean `EE_BIN_DIR`:
```bash
EE_DATA_DIR=/tmp/ee-data npm -w @event-editor/web run dev
# then:
curl -s -X POST localhost:3000/api/deps/ytdlp
```
Expected: `{"version":"<yyyy.mm.dd>"}` and `/tmp/ee-data/bin/yt-dlp` exists and is executable.

- [ ] **Step 7: Commit**

```bash
git add packages/web/lib/deps.ts packages/web/lib/deps.test.ts packages/web/app/api/deps/ytdlp/route.ts
git commit -m "feat(deps): yt-dlp managed downloader and status helpers"
```

---

### Task 10: Settings — Dependencies section

**Files:**
- Create: `packages/web/app/settings/Dependencies.tsx` (client component)
- Modify: `packages/web/app/settings/page.tsx` (render it, pass statuses)

**Interfaces:**
- Consumes: `dependencyStatuses` (and the `Dep` type) from `@/lib/deps`; `POST /api/deps/ytdlp`.
- Produces: a "Dependencies" section on Settings listing ffmpeg (Included), yt-dlp (Download / Update button, managed), LibreOffice (Open download page + hint).

- [ ] **Step 1: Wire the section into `page.tsx`**

In `packages/web/app/settings/page.tsx`, import and call `dependencyStatuses`, and render the client component. Add near the other sections (the page is already an async server component — see `SettingsBody`):

```tsx
import { dependencyStatuses } from "@/lib/deps";
import { Dependencies } from "./Dependencies";
// ...inside SettingsBody, after computing other data:
const deps = await dependencyStatuses();
// ...in the returned JSX, after the API keys section:
<h2 className="mt-8 text-lg font-semibold">Dependencies</h2>
<Dependencies deps={deps} />
```

- [ ] **Step 2: Write `Dependencies.tsx`**

A client component that takes `deps: Dep[]` and renders one row per dependency, house-standards styled (import the `Dep` type from `@/lib/deps`):
- **Status pill:** green "Ready" when `ready`, grey "Not installed" otherwise (reuse the pill look from `ConnectionPills`).
- **ffmpeg** (`managed: false`, no `installUrl`): show the `hint` ("Bundled with the app.") and no action button.
- **yt-dlp** (`managed: true`): a primary button labelled "Download" when not ready, "Update" when ready. On click, POST `/api/deps/ytdlp`, show `.is-loading` spinner, then on success show a green line "Installed yt-dlp <version>" and (optionally) `router.refresh()` to re-read status; on error show the returned message in red. Show the current `version` when present.
- **LibreOffice** (`managed: false`, has `installUrl`): a secondary button "Open download page" that opens `installUrl` in a new tab (`window.open(url, "_blank", "noopener")`), plus the `hint` shown as muted helper text.

Follow anti-vibecode: one card, single padding, rows separated by gap not nested boxes; buttons carry all interaction states; no em dashes in copy.

- [ ] **Step 3: Verify (manual, in the browser)**

With `npm -w @event-editor/web run dev` at `/settings`:
1. Dependencies section shows three rows.
2. ffmpeg row is green "Ready" with the bundled hint, no button.
3. yt-dlp row: click Download/Update, confirm spinner then a green "Installed yt-dlp <version>" and the row flips to Ready.
4. LibreOffice row: reflects install state; "Open download page" opens libreoffice.org.

- [ ] **Step 4: Run the full suite**

Run: `npm -w @event-editor/core run build && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/settings/Dependencies.tsx packages/web/app/settings/page.tsx
git commit -m "feat(deps): Settings dependencies section with yt-dlp downloader"
```

---

## Notes for the desktop packaged app

The packaged Electron app runs the same web server, so `/convert` and the
dependencies section ship automatically. **ffmpeg** rides along via `ffmpeg-static`
(file mode and link-mode post-processing work with zero setup). **yt-dlp** is
fetched on demand into `<userData>/data/bin` by the Settings downloader and
resolved from there (`EE_BIN_DIR`); the user clicks Download once. **LibreOffice**
(slicer only) is not auto-installed — the section links its download page.
Rebuild and ship a new desktop version only after Parts A and B land and are
verified in `npm run dev`.
