# Audio Transcriber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third tool to event-editor: upload a large audio file, get a Google Doc containing a Claude-written summary plus the full timestamped transcript.

**Architecture:** Reuse the existing async-job-polled-by-UI pattern (no worker). A new `transcriptions` table tracks one row per upload. Pure helpers (chunk math, segment merge, timestamp/HTML/prompt building) live in `@event-editor/core`; an injected-deps orchestrator `runTranscription` drives the pipeline; impure wrappers in `packages/web/lib/` provide ffmpeg chunking (Groq's free tier caps request size, so large files are transcoded to 16kHz mono and split into ~10-min segments), Groq transcription, Claude summary, and Drive→Google-Doc creation.

**Tech Stack:** Next.js 16 route handlers, better-sqlite3 + Drizzle, `ffmpeg-static` + `ffprobe-static` (bundled platform binaries — no system install), Groq OpenAI-compatible `audio/transcriptions` API, `@anthropic-ai/sdk`, `googleapis` Drive v3.

Spec: `docs/superpowers/specs/2026-06-29-audio-transcriber-design.md`

## Global Constraints

- **Monorepo subpath imports:** web imports core via subpath exports (`@event-editor/core/transcribe`, `/transcription`, `/schema`, `/db`, `/tokens`, `/settings`), NEVER the barrel (the barrel pulls in native `better-sqlite3`).
- **Turbopack relative imports:** relative VALUE imports inside a package must be EXTENSIONLESS (`./metrics`, not `./metrics.js`). `import type ... from "./x.js"` is fine (erased at compile). Core-internal imports keep `.js` (compiled by `tsc`, run by Node) — match each file's existing convention.
- **Build core before web tests:** web tests import built core dist. After any change under `packages/core/src`, run `npm -w @event-editor/core run build` before running web tests.
- **No em dashes** in code comments or UI copy (house rule). Use a hyphen or rephrase.
- **Anti-vibecode UI:** LIGHT mode, one accent, existing token classes (`card`, `btn`, `btn-accent`, `eyebrow`, `text-muted`, `text-success`, `text-ink`, `border-line`, `bg-surface`, `bg-canvas`, `rounded-lg`). Match `/sorter` exactly.
- **Single-user threat model:** API routes are unauthenticated, consistent with the existing Sorter/Studio routes.
- **Env prefix `EE_`** for tunables; provider creds keep conventional names (`GROQ_API_KEY`).
- **Sequential + backoff:** never parallel-flood Groq; process chunks one at a time with 429/529 exponential backoff.

---

## File Structure

**Create (core):**
- `packages/core/src/transcribe.ts` — pure helpers
- `packages/core/src/transcription.ts` — `createTranscription`, `runTranscription`
- `packages/core/test/transcribe.test.ts`
- `packages/core/test/transcription.test.ts`

**Create (web):**
- `packages/web/lib/audio.ts` — ffmpeg/ffprobe wrappers + `segmentArgs`
- `packages/web/lib/groq.ts` — `transcribeChunk`
- `packages/web/lib/google/docs.ts` — `createGoogleDoc`
- `packages/web/lib/transcriber.ts` — `startTranscription` glue
- `packages/web/app/api/transcribe/route.ts` — POST (streaming upload)
- `packages/web/app/api/transcribe/[id]/route.ts` — GET (poll)
- `packages/web/app/transcribe/page.tsx` — server page + gate
- `packages/web/app/transcribe/TranscribeClient.tsx` — client UI
- `packages/web/test/audio.test.ts`, `groq.test.ts`, `docs.test.ts`
- `docs/setup/groq.md`

**Modify:**
- `packages/core/src/schema/index.ts` — add `transcriptions` table
- `packages/core/src/types.ts` — add types + `TranscriptionStatus`
- `packages/core/src/migrate.ts` — add DDL
- `packages/core/src/index.ts` — re-export new modules
- `packages/core/src/settings.ts` — add `groq` connection
- `packages/core/package.json` — add `./transcribe`, `./transcription` exports
- `packages/core/test/drift.test.ts` — cover `transcriptions`
- `packages/core/test/settings.test.ts` — expect `groq`
- `packages/web/lib/anthropic.ts` — add `summarizeTranscript`
- `packages/web/lib/google/oauth.ts` — add `drive.file` scope
- `packages/web/test/anthropic.test.ts` — cover `summarizeTranscript`
- `packages/web/test/google-oauth.test.ts` — assert `drive.file` scope present
- `packages/web/next.config.js` — add ffmpeg/ffprobe to `serverExternalPackages`
- `packages/web/package.json` — add `ffmpeg-static`, `ffprobe-static`
- `packages/web/app/page.tsx` — add Audio Transcriber card
- `.env.example` — add Groq + tunables

---

## Task 1: `transcriptions` schema, types, migration, drift guard

**Files:**
- Modify: `packages/core/src/schema/index.ts`
- Modify: `packages/core/src/types.ts:1-13`
- Modify: `packages/core/src/migrate.ts:5-61`
- Test: `packages/core/test/drift.test.ts`

**Interfaces:**
- Produces: Drizzle table `transcriptions`; types `Transcription`, `NewTranscription`, `TranscriptionStatus`.

- [ ] **Step 1: Extend the drift test to require the new table**

Add to `packages/core/test/drift.test.ts` — import `transcriptions` and add a case:

```typescript
// add transcriptions to the existing import from ../src/schema/index.js
import { jobs, photos, headshots, transcriptions } from "../src/schema/index.js";

// add inside describe("schema drift guard", ...)
  it("transcriptions DDL matches Drizzle schema", () => {
    const db = freshDb();
    const ddl = ddlColumns(db, "transcriptions");
    const schema = schemaColumns(transcriptions);
    expect(ddl).toEqual(schema);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @event-editor/core run test -- drift`
Expected: FAIL — `transcriptions` is not exported / table missing.

- [ ] **Step 3: Add the Drizzle table**

Append to `packages/core/src/schema/index.ts`:

```typescript
export const transcriptions = sqliteTable("transcriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  originalFilename: text("original_filename").notNull(),
  sourceUploadPath: text("source_upload_path").notNull(),
  durationSec: real("duration_sec"),
  status: text("status").notNull().default("uploading"), // uploading|transcribing|summarizing|creating_doc|done|error
  transcriptText: text("transcript_text"),
  summaryText: text("summary_text"),
  docId: text("doc_id"),
  docUrl: text("doc_url"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});
```

(`sqliteTable`, `integer`, `text`, `real` are already imported at the top of the file — confirm; add `real` to the import if absent.)

- [ ] **Step 4: Add types**

Append to `packages/core/src/types.ts`:

```typescript
import type { jobs, photos, headshots, transcriptions } from "./schema/index.js";
// (extend the existing import line to include transcriptions)

export type Transcription = typeof transcriptions.$inferSelect;
export type NewTranscription = typeof transcriptions.$inferInsert;
export type TranscriptionStatus =
  | "uploading"
  | "transcribing"
  | "summarizing"
  | "creating_doc"
  | "done"
  | "error";
```

- [ ] **Step 5: Add the migration DDL**

Add this string to the `DDL` array in `packages/core/src/migrate.ts` (after the `oauth_tokens` block):

```sql
CREATE TABLE IF NOT EXISTS transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_filename TEXT NOT NULL,
  source_upload_path TEXT NOT NULL,
  duration_sec REAL,
  status TEXT NOT NULL DEFAULT 'uploading',
  transcript_text TEXT,
  summary_text TEXT,
  doc_id TEXT,
  doc_url TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
)
```

- [ ] **Step 6: Run the drift test to verify it passes**

Run: `npm -w @event-editor/core run test -- drift`
Expected: PASS (all four tables).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/schema/index.ts packages/core/src/types.ts packages/core/src/migrate.ts packages/core/test/drift.test.ts
git commit -m "feat(core): transcriptions table, types, migration, drift guard"
```

---

## Task 2: Pure transcription helpers

**Files:**
- Create: `packages/core/src/transcribe.ts`
- Test: `packages/core/test/transcribe.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./transcribe.js";`)
- Modify: `packages/core/package.json` (add `"./transcribe": "./dist/transcribe.js"`)

**Interfaces:**
- Produces:
  - `interface PlannedChunk { index: number; startSec: number; durationSec: number }`
  - `function planChunks(durationSec: number, chunkSec: number): PlannedChunk[]`
  - `interface RawSegment { start: number; text: string }`
  - `interface ChunkResult { segments: RawSegment[] }`
  - `interface MergedSegment { startSec: number; text: string }`
  - `function mergeSegments(chunkResults: ChunkResult[], offsets: number[]): MergedSegment[]`
  - `function formatTimestamp(sec: number): string`
  - `function buildTranscriptHtml(summary: string, segments: MergedSegment[]): string`
  - `function buildSummaryPrompt(transcript: string): { role: "user"; content: string }[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/transcribe.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  planChunks,
  mergeSegments,
  formatTimestamp,
  buildTranscriptHtml,
  buildSummaryPrompt,
} from "../src/transcribe.js";

describe("planChunks", () => {
  it("splits a duration into chunkSec windows with offsets", () => {
    expect(planChunks(1500, 600)).toEqual([
      { index: 0, startSec: 0, durationSec: 600 },
      { index: 1, startSec: 600, durationSec: 600 },
      { index: 2, startSec: 1200, durationSec: 300 },
    ]);
  });
  it("returns a single chunk when shorter than chunkSec", () => {
    expect(planChunks(120, 600)).toEqual([{ index: 0, startSec: 0, durationSec: 120 }]);
  });
  it("returns one empty-edge chunk for zero/unknown duration", () => {
    expect(planChunks(0, 600)).toEqual([{ index: 0, startSec: 0, durationSec: 0 }]);
  });
});

describe("mergeSegments", () => {
  it("offsets each chunk's segment starts and concatenates in order", () => {
    const merged = mergeSegments(
      [
        { segments: [{ start: 0, text: "hello" }, { start: 5, text: "world" }] },
        { segments: [{ start: 1, text: "again" }] },
      ],
      [0, 600],
    );
    expect(merged).toEqual([
      { startSec: 0, text: "hello" },
      { startSec: 5, text: "world" },
      { startSec: 601, text: "again" },
    ]);
  });
  it("drops empty-text segments", () => {
    const merged = mergeSegments([{ segments: [{ start: 0, text: "  " }, { start: 1, text: "ok" }] }], [0]);
    expect(merged).toEqual([{ startSec: 1, text: "ok" }]);
  });
});

describe("formatTimestamp", () => {
  it("formats HH:MM:SS with zero padding", () => {
    expect(formatTimestamp(0)).toBe("00:00:00");
    expect(formatTimestamp(75)).toBe("00:01:15");
    expect(formatTimestamp(3725)).toBe("01:02:05");
  });
});

describe("buildTranscriptHtml", () => {
  it("renders summary and timestamped transcript sections, escaping html", () => {
    const html = buildTranscriptHtml("A <b>summary</b>", [{ startSec: 5, text: "first & line" }]);
    expect(html).toContain("<h1>Summary</h1>");
    expect(html).toContain("A &lt;b&gt;summary&lt;/b&gt;");
    expect(html).toContain("<h1>Transcript</h1>");
    expect(html).toContain("[00:00:05] first &amp; line");
  });
});

describe("buildSummaryPrompt", () => {
  it("wraps the transcript in a user message", () => {
    const msgs = buildSummaryPrompt("the words");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("the words");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w @event-editor/core run test -- transcribe`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `packages/core/src/transcribe.ts`:

```typescript
export interface PlannedChunk {
  index: number;
  startSec: number;
  durationSec: number;
}

export interface RawSegment {
  start: number;
  text: string;
}

export interface ChunkResult {
  segments: RawSegment[];
}

export interface MergedSegment {
  startSec: number;
  text: string;
}

export function planChunks(durationSec: number, chunkSec: number): PlannedChunk[] {
  if (durationSec <= 0) return [{ index: 0, startSec: 0, durationSec: 0 }];
  const chunks: PlannedChunk[] = [];
  let index = 0;
  for (let start = 0; start < durationSec; start += chunkSec) {
    chunks.push({ index, startSec: start, durationSec: Math.min(chunkSec, durationSec - start) });
    index++;
  }
  return chunks;
}

export function mergeSegments(chunkResults: ChunkResult[], offsets: number[]): MergedSegment[] {
  const out: MergedSegment[] = [];
  chunkResults.forEach((chunk, i) => {
    const offset = offsets[i] ?? i * 0;
    for (const seg of chunk.segments) {
      const text = seg.text.trim();
      if (!text) continue;
      out.push({ startSec: offset + seg.start, text });
    }
  });
  return out;
}

export function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildTranscriptHtml(summary: string, segments: MergedSegment[]): string {
  const summaryParas = summary
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
  const lines = segments
    .map((seg) => `<p>[${formatTimestamp(seg.startSec)}] ${escapeHtml(seg.text)}</p>`)
    .join("");
  return `<h1>Summary</h1>${summaryParas}<h1>Transcript</h1>${lines}`;
}

export function buildSummaryPrompt(transcript: string): { role: "user"; content: string }[] {
  return [
    {
      role: "user",
      content:
        "You are summarizing a transcript of an audio recording. " +
        "Write a concise summary in clear prose: open with one sentence on what the recording is about, " +
        "then the key points and any decisions or action items as short paragraphs. " +
        "Do not use em dashes. Return only the summary text, no preamble.\n\n" +
        "Transcript:\n" +
        transcript,
    },
  ];
}
```

- [ ] **Step 4: Wire up exports**

Add to `packages/core/src/index.ts`:

```typescript
export * from "./transcribe.js";
```

Add to the `exports` map in `packages/core/package.json` (after `"./ranking"`):

```json
    "./transcribe": "./dist/transcribe.js",
```

- [ ] **Step 5: Run to verify passing**

Run: `npm -w @event-editor/core run test -- transcribe`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/transcribe.ts packages/core/test/transcribe.test.ts packages/core/src/index.ts packages/core/package.json
git commit -m "feat(core): pure transcription helpers (chunks, merge, timestamp, html, prompt)"
```

---

## Task 3: Orchestrator — `createTranscription` + `runTranscription`

**Files:**
- Create: `packages/core/src/transcription.ts`
- Test: `packages/core/test/transcription.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./transcription.js";`)
- Modify: `packages/core/package.json` (add `"./transcription": "./dist/transcription.js"`)

**Interfaces:**
- Consumes: `planChunks`, `mergeSegments`, `ChunkResult` from `./transcribe.js`; `transcriptions` from `./schema/index.js`.
- Produces:
  - `function createTranscription(db, args: { originalFilename: string }): number`
  - `interface PreparedChunks { paths: string[]; offsets: number[]; durationSec: number }`
  - `interface TranscriptionDeps { prepareChunks(sourcePath: string, chunkSec: number): Promise<PreparedChunks>; transcribeChunk(path: string): Promise<ChunkResult>; summarize(transcript: string): Promise<string>; createDoc(html: string, name: string): Promise<{ id: string; url: string }>; }`
  - `function runTranscription(db, id: number, deps: TranscriptionDeps, opts?: { chunkSec?: number }): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/transcription.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  openDb,
  runMigrations,
  transcriptions,
  createTranscription,
  runTranscription,
} from "../src/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-tx-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

const happyDeps = {
  prepareChunks: async () => ({ paths: ["c0", "c1"], offsets: [0, 600], durationSec: 1234 }),
  transcribeChunk: async (p: string) => ({
    segments: p === "c0" ? [{ start: 0, text: "alpha" }] : [{ start: 2, text: "beta" }],
  }),
  summarize: async () => "the summary",
  createDoc: async () => ({ id: "doc1", url: "https://docs/doc1" }),
};

describe("runTranscription", () => {
  it("transcribes, summarizes, creates a doc, and marks done", async () => {
    const db = freshDb();
    const id = createTranscription(db, { originalFilename: "talk.mp3" });
    db.update(transcriptions).set({ sourceUploadPath: "data/uploads/x/talk.mp3" }).where(eq(transcriptions.id, id)).run();

    await runTranscription(db, id, happyDeps, { chunkSec: 600 });

    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("done");
    expect(row.durationSec).toBe(1234);
    expect(row.transcriptText).toContain("alpha");
    expect(row.transcriptText).toContain("beta");
    expect(row.summaryText).toBe("the summary");
    expect(row.docId).toBe("doc1");
    expect(row.docUrl).toBe("https://docs/doc1");
  });

  it("marks the row error when a step throws", async () => {
    const db = freshDb();
    const id = createTranscription(db, { originalFilename: "bad.mp3" });
    db.update(transcriptions).set({ sourceUploadPath: "data/uploads/y/bad.mp3" }).where(eq(transcriptions.id, id)).run();

    await runTranscription(
      db,
      id,
      { ...happyDeps, transcribeChunk: async () => { throw new Error("groq down"); } },
      { chunkSec: 600 },
    );

    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("error");
    expect(row.errorMessage).toMatch(/groq down/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w @event-editor/core run test -- transcription`
Expected: FAIL — `createTranscription`/`runTranscription` not exported.

- [ ] **Step 3: Implement the orchestrator**

Create `packages/core/src/transcription.ts`:

```typescript
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { transcriptions } from "./schema/index.js";
import { mergeSegments, buildTranscriptHtml, type ChunkResult, type MergedSegment } from "./transcribe.js";

export interface PreparedChunks {
  paths: string[];
  offsets: number[];
  durationSec: number;
}

export interface TranscriptionDeps {
  prepareChunks(sourcePath: string, chunkSec: number): Promise<PreparedChunks>;
  transcribeChunk(path: string): Promise<ChunkResult>;
  summarize(transcript: string): Promise<string>;
  createDoc(html: string, name: string): Promise<{ id: string; url: string }>;
}

const DEFAULT_CHUNK_SEC = Number(process.env.EE_TRANSCRIBE_CHUNK_SEC ?? 600);

function touch(db: BetterSQLite3Database<any>, id: number, set: Record<string, unknown>) {
  db.update(transcriptions).set({ ...set, updatedAt: Date.now() }).where(eq(transcriptions.id, id)).run();
}

export function createTranscription(
  db: BetterSQLite3Database<any>,
  args: { originalFilename: string },
): number {
  const now = Date.now();
  const res = db
    .insert(transcriptions)
    .values({
      originalFilename: args.originalFilename,
      sourceUploadPath: "",
      status: "uploading",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return Number(res.lastInsertRowid);
}

function plainText(segments: MergedSegment[]): string {
  return segments.map((s) => s.text).join(" ");
}

export async function runTranscription(
  db: BetterSQLite3Database<any>,
  id: number,
  deps: TranscriptionDeps,
  opts?: { chunkSec?: number },
): Promise<void> {
  const chunkSec = opts?.chunkSec ?? DEFAULT_CHUNK_SEC;
  try {
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    if (!row) throw new Error(`transcription ${id} not found`);

    touch(db, id, { status: "transcribing" });
    const prepared = await deps.prepareChunks(row.sourceUploadPath, chunkSec);
    touch(db, id, { durationSec: prepared.durationSec });

    const results: ChunkResult[] = [];
    for (const path of prepared.paths) {
      results.push(await deps.transcribeChunk(path));
    }
    const segments = mergeSegments(results, prepared.offsets);
    const transcript = plainText(segments);
    touch(db, id, { transcriptText: transcript, status: "summarizing" });

    const summary = await deps.summarize(transcript);
    touch(db, id, { summaryText: summary, status: "creating_doc" });

    const html = buildTranscriptHtml(summary, segments);
    const docName = row.originalFilename.replace(/\.[^.]+$/, "") + " transcript";
    const doc = await deps.createDoc(html, docName);
    touch(db, id, { docId: doc.id, docUrl: doc.url, status: "done" });
  } catch (err) {
    touch(db, id, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 4: Wire up exports**

Add to `packages/core/src/index.ts`:

```typescript
export * from "./transcription.js";
```

Add to `packages/core/package.json` exports map:

```json
    "./transcription": "./dist/transcription.js",
```

- [ ] **Step 5: Run to verify passing**

Run: `npm -w @event-editor/core run test -- transcription`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/transcription.ts packages/core/test/transcription.test.ts packages/core/src/index.ts packages/core/package.json
git commit -m "feat(core): runTranscription orchestrator + createTranscription"
```

---

## Task 4: ffmpeg/ffprobe wrapper (`audio.ts`)

**Files:**
- Create: `packages/web/lib/audio.ts`
- Test: `packages/web/test/audio.test.ts`
- Modify: `packages/web/package.json` (add deps)
- Modify: `packages/web/next.config.js`

**Interfaces:**
- Produces:
  - `function segmentArgs(input: string, outPattern: string, chunkSec: number): string[]` (pure)
  - `function probeDuration(input: string): Promise<number>`
  - `function transcodeAndSegment(input: string, outDir: string, chunkSec: number): Promise<string[]>`

- [ ] **Step 1: Install the binaries**

```bash
npm -w @event-editor/web install ffmpeg-static@^5.2.0 ffprobe-static@^3.1.0
```

(These ship prebuilt per-platform binaries — darwin-arm64 included. No system ffmpeg needed.)

- [ ] **Step 2: Add to serverExternalPackages**

Edit `packages/web/next.config.js` so the array reads:

```javascript
  serverExternalPackages: ["better-sqlite3", "sharp", "@anthropic-ai/sdk", "ffmpeg-static", "ffprobe-static"],
```

- [ ] **Step 3: Write the failing test (pure arg builder)**

Create `packages/web/test/audio.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { segmentArgs } from "../lib/audio";

describe("segmentArgs", () => {
  it("builds ffmpeg args for 16kHz mono mp3 segmenting", () => {
    const args = segmentArgs("/in/talk.m4a", "/out/chunk_%03d.mp3", 600);
    expect(args).toEqual([
      "-i", "/in/talk.m4a",
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-f", "segment",
      "-segment_time", "600",
      "-c:a", "libmp3lame",
      "-q:a", "5",
      "/out/chunk_%03d.mp3",
    ]);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm -w @event-editor/web run test -- audio`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the wrapper**

Create `packages/web/lib/audio.ts`. Note: `ffmpeg-static` default export is the binary path (string); `ffprobe-static` default export is `{ path }`. Relative-import-free (no intra-package relative value imports here).

```typescript
import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

export function segmentArgs(input: string, outPattern: string, chunkSec: number): string[] {
  return [
    "-i", input,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-f", "segment",
    "-segment_time", String(chunkSec),
    "-c:a", "libmp3lame",
    "-q:a", "5",
    outPattern,
  ];
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

export async function probeDuration(input: string): Promise<number> {
  const out = await run(ffprobeStatic.path, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    input,
  ]);
  const seconds = parseFloat(out.trim());
  return Number.isFinite(seconds) ? seconds : 0;
}

export async function transcodeAndSegment(input: string, outDir: string, chunkSec: number): Promise<string[]> {
  if (!ffmpegPath) throw new Error("ffmpeg binary not found");
  await mkdir(outDir, { recursive: true });
  await run(ffmpegPath, segmentArgs(input, join(outDir, "chunk_%03d.mp3"), chunkSec));
  const files = (await readdir(outDir)).filter((f) => f.startsWith("chunk_") && f.endsWith(".mp3")).sort();
  return files.map((f) => join(outDir, f));
}
```

- [ ] **Step 6: Run to verify passing**

Run: `npm -w @event-editor/web run test -- audio`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/lib/audio.ts packages/web/test/audio.test.ts packages/web/package.json packages/web/package-lock.json packages/web/next.config.js package-lock.json
git commit -m "feat(web): ffmpeg/ffprobe audio chunking wrapper"
```

---

## Task 5: Groq transcription client (`groq.ts`)

**Files:**
- Create: `packages/web/lib/groq.ts`
- Test: `packages/web/test/groq.test.ts`

**Interfaces:**
- Consumes: `ChunkResult` from `@event-editor/core/transcribe`.
- Produces: `const TRANSCRIBE_MODEL: string`; `function transcribeChunk(path: string): Promise<ChunkResult>`.

- [ ] **Step 1: Build core so the subpath import resolves**

Run: `npm -w @event-editor/core run build`

- [ ] **Step 2: Write the failing test**

Create `packages/web/test/groq.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

const { transcribeChunk, TRANSCRIBE_MODEL } = await import("../lib/groq.js");

afterEach(() => vi.restoreAllMocks());

async function fixture(): Promise<string> {
  const p = join(tmpdir(), `ee-groq-${Math.random().toString(36).slice(2)}.mp3`);
  await writeFile(p, Buffer.from([0x49, 0x44, 0x33]));
  return p;
}

describe("transcribeChunk", () => {
  it("posts to Groq and maps verbose_json segments", async () => {
    process.env.GROQ_API_KEY = "k";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ segments: [{ start: 0, text: " hi " }, { start: 3, text: "there" }] }), {
        status: 200,
      }),
    );
    const out = await transcribeChunk(await fixture());
    expect(out.segments).toEqual([{ start: 0, text: " hi " }, { start: 3, text: "there" }]);
    const url = fetchMock.mock.calls[0][0];
    expect(String(url)).toContain("/audio/transcriptions");
  });

  it("throws with .status on a non-ok response (so backoff can see 429)", async () => {
    process.env.GROQ_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate", { status: 429 }));
    await expect(transcribeChunk(await fixture())).rejects.toMatchObject({ status: 429 });
  });

  it("defaults the model to a whisper variant", () => {
    expect(TRANSCRIBE_MODEL).toContain("whisper");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm -w @event-editor/web run test -- groq`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the client**

Create `packages/web/lib/groq.ts` (extensionless relative-free; type-only import from core subpath):

```typescript
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ChunkResult } from "@event-editor/core/transcribe";

export const TRANSCRIBE_MODEL = process.env.EE_TRANSCRIBE_MODEL ?? "whisper-large-v3-turbo";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function transcribeChunk(path: string): Promise<ChunkResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");

  const bytes = await readFile(path);
  const form = new FormData();
  form.append("file", new Blob([bytes]), basename(path));
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: any = new Error(`groq transcription failed: ${res.status} ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data: any = await res.json();
  const segments = (data.segments ?? []).map((s: any) => ({
    start: Number(s.start) || 0,
    text: String(s.text ?? ""),
  }));
  return { segments };
}
```

- [ ] **Step 5: Run to verify passing**

Run: `npm -w @event-editor/web run test -- groq`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/groq.ts packages/web/test/groq.test.ts
git commit -m "feat(web): groq whisper transcription client (verbose_json segments)"
```

---

## Task 6: Claude summary (`summarizeTranscript`)

**Files:**
- Modify: `packages/web/lib/anthropic.ts`
- Test: `packages/web/test/anthropic.test.ts`

**Interfaces:**
- Consumes: `buildSummaryPrompt` from `@event-editor/core/transcribe`.
- Produces: `const SUMMARY_MODEL: string`; `function summarizeTranscript(client: Anthropic, transcript: string): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Append to `packages/web/test/anthropic.test.ts`:

```typescript
import { summarizeTranscript, SUMMARY_MODEL } from "../lib/anthropic.js";

function textClient(text: string, stop = "end_turn") {
  return {
    messages: { create: vi.fn(async () => ({ stop_reason: stop, content: [{ type: "text", text }] })) },
  } as any;
}

describe("summarizeTranscript", () => {
  it("returns the model's summary text", async () => {
    const client = textClient("Here is a tidy summary.");
    const out = await summarizeTranscript(client, "lots of words");
    expect(out).toBe("Here is a tidy summary.");
  });
  it("throws on a refusal", async () => {
    const client = textClient("", "refusal");
    await expect(summarizeTranscript(client, "x")).rejects.toThrow();
  });
  it("defaults the summary model to a claude model", () => {
    expect(SUMMARY_MODEL).toContain("claude-");
  });
});
```

(`vi` and `describe`/`it`/`expect` are already imported at the top of the file from the existing test.)

- [ ] **Step 2: Build core, then run to verify failure**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/web run test -- anthropic`
Expected: FAIL — `summarizeTranscript` not exported.

- [ ] **Step 3: Implement**

Append to `packages/web/lib/anthropic.ts`:

```typescript
import { buildSummaryPrompt } from "@event-editor/core/transcribe";

export const SUMMARY_MODEL = process.env.EE_SUMMARY_MODEL ?? "claude-opus-4-8";

export async function summarizeTranscript(client: Anthropic, transcript: string): Promise<string> {
  const res: any = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 2048,
    messages: buildSummaryPrompt(transcript),
  } as any);
  if (res.stop_reason === "refusal") {
    throw new Error("summary model refused to summarize this transcript");
  }
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  if (!text.trim()) throw new Error("summary model returned empty output");
  return text.trim();
}
```

(Add the `buildSummaryPrompt` import alongside the existing `buildVisionPrompt` import — they share the `@event-editor/core/...` namespace but live in different subpaths, so it is a separate import line.)

- [ ] **Step 4: Run to verify passing**

Run: `npm -w @event-editor/web run test -- anthropic`
Expected: PASS (existing scorePhoto tests + new summary tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/anthropic.ts packages/web/test/anthropic.test.ts
git commit -m "feat(web): summarizeTranscript via Claude"
```

---

## Task 7: Google write scope + Doc creation (`docs.ts`)

**Files:**
- Modify: `packages/web/lib/google/oauth.ts:7-23`
- Modify: `packages/web/test/google-oauth.test.ts`
- Create: `packages/web/lib/google/docs.ts`
- Test: `packages/web/test/docs.test.ts`

**Interfaces:**
- Produces: `const DRIVE_FILE_SCOPE: string`; `function createGoogleDoc(drive, html: string, name: string): Promise<{ id: string; url: string }>`.

- [ ] **Step 1: Add the scope assertion to the oauth test**

In `packages/web/test/google-oauth.test.ts`, extend the first test and import `DRIVE_FILE_SCOPE`:

```typescript
const { makeOAuthClient, buildAuthUrl, exchangeCode, DRIVE_SCOPE, DRIVE_FILE_SCOPE } = await import("../lib/google/oauth.js");

// inside the "builds an offline consent auth url" test, add:
  expect(url).toContain("drive.file");
```

- [ ] **Step 2: Write the failing docs test**

Create `packages/web/test/docs.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createGoogleDoc } from "../lib/google/docs";

describe("createGoogleDoc", () => {
  it("creates a Google Doc from html and returns id + url", async () => {
    const create = vi.fn(async () => ({ data: { id: "doc99", webViewLink: "https://docs.google.com/doc99" } }));
    const drive = { files: { create } } as any;
    const out = await createGoogleDoc(drive, "<h1>Summary</h1><p>hi</p>", "talk transcript");
    expect(out).toEqual({ id: "doc99", url: "https://docs.google.com/doc99" });
    const arg = create.mock.calls[0][0];
    expect(arg.requestBody.mimeType).toBe("application/vnd.google-apps.document");
    expect(arg.requestBody.name).toBe("talk transcript");
    expect(arg.media.mimeType).toBe("text/html");
  });
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `npm -w @event-editor/web run test -- "oauth|docs"`
Expected: FAIL — `DRIVE_FILE_SCOPE` / `createGoogleDoc` not found.

- [ ] **Step 4: Widen the OAuth scope**

In `packages/web/lib/google/oauth.ts`, add the constant and include it in `buildAuthUrl`:

```typescript
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export function buildAuthUrl(client: OAuth2Client): string {
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE, DRIVE_FILE_SCOPE],
  });
}
```

- [ ] **Step 5: Implement Doc creation**

Create `packages/web/lib/google/docs.ts`:

```typescript
import { Readable } from "node:stream";
import type { drive_v3 } from "googleapis";

export async function createGoogleDoc(
  drive: drive_v3.Drive,
  html: string,
  name: string,
): Promise<{ id: string; url: string }> {
  const res = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.document" },
    media: { mimeType: "text/html", body: Readable.from(html) },
    fields: "id, webViewLink",
  });
  const id = res.data.id;
  if (!id) throw new Error("Drive did not return a document id");
  return { id, url: res.data.webViewLink ?? `https://docs.google.com/document/d/${id}/edit` };
}
```

- [ ] **Step 6: Run to verify passing**

Run: `npm -w @event-editor/web run test -- "oauth|docs"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/lib/google/oauth.ts packages/web/lib/google/docs.ts packages/web/test/google-oauth.test.ts packages/web/test/docs.test.ts
git commit -m "feat(web): drive.file scope + createGoogleDoc (html to Google Doc)"
```

---

## Task 8: Groq connection in settings + env + setup doc

**Files:**
- Modify: `packages/core/src/settings.ts`
- Test: `packages/core/test/settings.test.ts`
- Modify: `.env.example`
- Create: `docs/setup/groq.md`

**Interfaces:**
- Produces: `ConnectionId` includes `"groq"`; `getConnections` reports it.

- [ ] **Step 1: Update the settings test**

In `packages/core/test/settings.test.ts`, update the id list and add a groq case:

```typescript
  it("reports unconfigured when env empty", () => {
    const conns = getConnections({});
    expect(conns.map((c) => c.id).sort()).toEqual(["anthropic", "canva", "google", "groq"]);
    expect(conns.every((c) => c.configured === false)).toBe(true);
  });

  it("reports groq configured when its key present", () => {
    const conns = getConnections({ GROQ_API_KEY: "k" });
    expect(conns.find((c) => c.id === "groq")?.configured).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w @event-editor/core run test -- settings`
Expected: FAIL — groq missing.

- [ ] **Step 3: Add the connection**

In `packages/core/src/settings.ts`:

```typescript
export type ConnectionId = "google" | "anthropic" | "canva" | "groq";
```

Add to the `REQUIRED` map:

```typescript
  groq: { label: "Groq (transcription)", vars: ["GROQ_API_KEY"] },
```

- [ ] **Step 4: Run to verify passing**

Run: `npm -w @event-editor/core run test -- settings`
Expected: PASS.

- [ ] **Step 5: Extend `.env.example`**

Append to `.env.example`:

```
GROQ_API_KEY=
EE_TRANSCRIBE_MODEL=whisper-large-v3-turbo
EE_SUMMARY_MODEL=claude-opus-4-8
EE_TRANSCRIBE_CHUNK_SEC=600
```

- [ ] **Step 6: Write the setup doc**

Create `docs/setup/groq.md`:

```markdown
# Groq (audio transcription)

The Audio Transcriber uses Groq's free Whisper API.

1. Create a free account at https://console.groq.com.
2. Create an API key (API Keys -> Create API Key).
3. Put it in `.env`: `GROQ_API_KEY=gsk_...`
4. Restart the dev server.

Notes:
- The free tier rate-limits audio seconds per hour, so a multi-hour file
  transcribes in sequential chunks with backoff. It finishes, just not instantly.
- Large files are transcoded to 16kHz mono and split into ~10-minute chunks
  locally (ffmpeg, bundled) to stay under the free-tier request size cap.
- Set `EE_TRANSCRIBE_MODEL` to override the default `whisper-large-v3-turbo`.

## Google Doc output

The transcriber writes the result to a Google Doc, which needs Drive **write**
access (`drive.file` scope). This is broader than the Sorter's read-only scope,
so after upgrading you must re-connect Google once: go to `/settings` and click
Re-auth on the Google row. `drive.file` only grants access to files this app
creates; it cannot read or change your existing Drive content.
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/settings.ts packages/core/test/settings.test.ts .env.example docs/setup/groq.md
git commit -m "feat: groq connection in settings, env example, setup doc"
```

---

## Task 9: Web glue + API routes

**Files:**
- Create: `packages/web/lib/transcriber.ts`
- Create: `packages/web/app/api/transcribe/route.ts`
- Create: `packages/web/app/api/transcribe/[id]/route.ts`

**Interfaces:**
- Consumes: `createTranscription`, `runTranscription`, `transcriptions` (core); `transcodeAndSegment`, `probeDuration` (audio); `transcribeChunk` (groq); `visionClient`/`summarizeTranscript` (anthropic); `authedDriveClient` (oauth); `createGoogleDoc` (docs); `planChunks` (core).
- Produces: `function startTranscription(db, id: number): void`.

There is no unit test for this glue (it wires real I/O, same posture as `lib/sorter.ts`); it is exercised by the core orchestrator test (Task 3) and manual live verification. Steps are build + typecheck + commit.

- [ ] **Step 1: Implement the glue**

Create `packages/web/lib/transcriber.ts`:

```typescript
import { resolve, dirname } from "node:path";
import { eq } from "drizzle-orm";
import { runTranscription, planChunks } from "@event-editor/core/transcription";
import { transcriptions } from "@event-editor/core/schema";
import type { openDb } from "@event-editor/core/db";
import { transcodeAndSegment, probeDuration } from "./audio";
import { transcribeChunk } from "./groq";
import { visionClient, summarizeTranscript } from "./anthropic";
import { authedDriveClient } from "./google/oauth";
import { createGoogleDoc } from "./google/docs";

type Db = ReturnType<typeof openDb>;

async function withBackoff<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.statusCode;
      if (status !== 429 && status !== 529) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

function fail(db: Db, id: number, message: string) {
  db.update(transcriptions)
    .set({ status: "error", errorMessage: message, updatedAt: Date.now() })
    .where(eq(transcriptions.id, id))
    .run();
}

export function startTranscription(db: Db, id: number): void {
  // Preflight keys synchronously: missing-key throws would otherwise land
  // outside runTranscription's try/catch and strand the row.
  if (!process.env.GROQ_API_KEY) return fail(db, id, "GROQ_API_KEY is not set");
  if (!process.env.ANTHROPIC_API_KEY) return fail(db, id, "ANTHROPIC_API_KEY is not set");

  const client = visionClient();

  void runTranscription(db, id, {
    prepareChunks: async (sourcePath, chunkSec) => {
      const durationSec = await probeDuration(resolve(sourcePath));
      const outDir = resolve(dirname(resolve(sourcePath)), "chunks");
      const paths = await transcodeAndSegment(resolve(sourcePath), outDir, chunkSec);
      const offsets = planChunks(durationSec, chunkSec).map((c) => c.startSec);
      while (offsets.length < paths.length) offsets.push(offsets.length * chunkSec);
      return { paths, offsets: offsets.slice(0, paths.length), durationSec };
    },
    transcribeChunk: (path) => withBackoff(() => transcribeChunk(path)),
    summarize: (transcript) => withBackoff(() => summarizeTranscript(client, transcript)),
    createDoc: async (html, name) => {
      const drive = await authedDriveClient(db);
      if (!drive) throw new Error("Google is not connected. Re-auth on /settings.");
      return createGoogleDoc(drive, html, name);
    },
  });
}
```

- [ ] **Step 2: Implement the upload route (streaming)**

Create `packages/web/app/api/transcribe/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { createTranscription } from "@event-editor/core/transcription";
import { transcriptions } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { startTranscription } from "@/lib/transcriber";

export const runtime = "nodejs";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "audio";
}

export async function POST(request: Request) {
  const raw = request.headers.get("x-filename") ?? new URL(request.url).searchParams.get("filename");
  if (!raw) return NextResponse.json({ error: "x-filename header required" }, { status: 400 });
  if (!request.body) return NextResponse.json({ error: "empty body" }, { status: 400 });

  const filename = safeName(raw);
  const db = getDb();
  const id = createTranscription(db, { originalFilename: filename });

  const dir = resolve("data/uploads", String(id));
  const path = resolve(dir, filename);
  await mkdir(dir, { recursive: true });
  await pipeline(Readable.fromWeb(request.body as any), createWriteStream(path));

  db.update(transcriptions)
    .set({ sourceUploadPath: `data/uploads/${id}/${filename}`, updatedAt: Date.now() })
    .where(eq(transcriptions.id, id))
    .run();

  startTranscription(db, id);
  return NextResponse.json({ id });
}
```

- [ ] **Step 3: Implement the poll route**

Create `packages/web/app/api/transcribe/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().select().from(transcriptions).where(eq(transcriptions.id, Number(id))).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    transcription: {
      id: row.id,
      originalFilename: row.originalFilename,
      status: row.status,
      durationSec: row.durationSec,
      summaryText: row.summaryText,
      docUrl: row.docUrl,
      errorMessage: row.errorMessage,
    },
  });
}
```

- [ ] **Step 4: Build core, then typecheck the web build compiles**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/web run build`
Expected: build completes with no type errors; `/api/transcribe` routes appear in the route list.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/transcriber.ts packages/web/app/api/transcribe
git commit -m "feat(web): transcribe glue + streaming upload and poll routes"
```

---

## Task 10: UI — `/transcribe` page, client, landing card

**Files:**
- Create: `packages/web/app/transcribe/page.tsx`
- Create: `packages/web/app/transcribe/TranscribeClient.tsx`
- Modify: `packages/web/app/page.tsx`

**Interfaces:**
- Consumes: `getConnections` (core/settings); the `/api/transcribe` routes.

No unit test (UI), same posture as `SorterClient`. Verification is a clean build + manual.

- [ ] **Step 1: Server page with connection gate**

Create `packages/web/app/transcribe/page.tsx`:

```tsx
import { getConnections } from "@event-editor/core/settings";
import { TranscribeClient } from "./TranscribeClient";

export default function TranscribePage() {
  const conns = getConnections();
  const groq = conns.find((c) => c.id === "groq");
  const google = conns.find((c) => c.id === "google");
  const anthropic = conns.find((c) => c.id === "anthropic");
  const missing: string[] = [];
  if (!groq?.configured) missing.push("GROQ_API_KEY");
  if (!anthropic?.configured) missing.push("ANTHROPIC_API_KEY");
  if (!google?.configured) missing.push("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");

  return (
    <div>
      <p className="eyebrow">Audio transcriber</p>
      <h1 className="mt-1 text-2xl font-semibold">Transcribe audio to a Google Doc</h1>
      {missing.length > 0 ? (
        <div className="card mt-8">
          <p className="text-muted">Set these in .env, then restart:</p>
          <ul className="mt-2 list-disc pl-5 text-muted">
            {missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <p className="mt-2 text-muted">
            Google also needs write access for this tool. Re-auth on{" "}
            <a className="underline" href="/settings">settings</a> after connecting.
          </p>
        </div>
      ) : (
        <TranscribeClient />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Client component (upload + poll + result)**

Create `packages/web/app/transcribe/TranscribeClient.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

interface Transcription {
  id: number;
  originalFilename: string;
  status: string;
  durationSec: number | null;
  summaryText: string | null;
  docUrl: string | null;
  errorMessage: string | null;
}

export function TranscribeClient() {
  const [id, setId] = useState<number | null>(null);
  const [tx, setTx] = useState<Transcription | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id == null) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/transcribe/${id}`);
      if (!r.ok) return false;
      const data = await r.json();
      setTx(data.transcription);
      return data.transcription.status === "done" || data.transcription.status === "error";
    };
    const loop = async () => { while (!stop) { if (await tick()) break; await new Promise((r) => setTimeout(r, 1500)); } };
    loop();
    return () => { stop = true; };
  }, [id]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setTx(null);
    const r = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "x-filename": file.name },
      body: file,
    });
    const data = await r.json();
    setBusy(false);
    if (data.id) setId(data.id);
  }

  return (
    <div className="mt-8">
      <div className="card flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept="audio/*,video/*" className="text-sm text-muted" />
        <button className="btn btn-accent" onClick={upload} disabled={busy}>
          {busy ? "Uploading…" : "Transcribe"}
        </button>
      </div>

      {tx && (
        <div className="card mt-5">
          <p className="eyebrow">{tx.originalFilename}</p>
          {tx.status === "error" ? (
            <p className="text-[color:#b42318]">Failed: {tx.errorMessage}</p>
          ) : tx.status === "done" ? (
            <>
              <p className="text-success">Done.</p>
              {tx.docUrl && (
                <a className="btn btn-accent mt-3" href={tx.docUrl} target="_blank" rel="noreferrer">
                  Open in Google Docs
                </a>
              )}
              {tx.summaryText && (
                <div className="mt-4">
                  <p className="eyebrow">Summary</p>
                  <p className="mt-1 whitespace-pre-wrap text-ink">{tx.summaryText}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted">{phaseLabel(tx.status)}</p>
          )}
        </div>
      )}
    </div>
  );
}

function phaseLabel(status: string): string {
  switch (status) {
    case "uploading": return "Uploading";
    case "transcribing": return "Transcribing audio";
    case "summarizing": return "Summarizing with Claude";
    case "creating_doc": return "Creating the Google Doc";
    default: return status;
  }
}
```

- [ ] **Step 3: Add the landing card**

In `packages/web/app/page.tsx`: change the eyebrow to `Three tools, one workspace`, the grid to `sm:grid-cols-3`, and add a third card after the Headshot studio card:

```tsx
        <ToolCard
          href="/transcribe"
          eyebrow="Audio transcriber"
          title="Transcribe audio to a Google Doc"
          body="Upload a large audio file and get a Google Doc with a summary and the full timestamped transcript."
        />
```

- [ ] **Step 4: Build to verify it compiles**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/web run build`
Expected: clean build; `/transcribe` in the route list.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/transcribe packages/web/app/page.tsx
git commit -m "feat(web): /transcribe UI + landing card"
```

---

## Final verification (after all tasks)

- [ ] `npm -w @event-editor/core run build`
- [ ] `npm test` — core + web suites green (run from repo root).
- [ ] `npm run build` — full `next build` clean.
- [ ] Confirm new tables/routes: `transcriptions` table created on a fresh `data/app.db` after `npm run migrate`; `/api/transcribe` and `/transcribe` present in the build route list.
- [ ] Update `.superpowers/sdd/progress.md` with the plan's task outcomes and any minors for final triage.

## Live verification (manual, gated on setup)

1. `GROQ_API_KEY` in `.env`; `ANTHROPIC_API_KEY` set; Google connected.
2. Re-auth Google at `/settings` to grant `drive.file`.
3. `npm run dev`, open `/transcribe`, upload a short audio file first (sanity), then a large one.
4. Confirm the Doc appears in Drive with a summary + timestamped transcript and the "Open in Google Docs" link works.

---

## Self-Review

**Spec coverage:** transcription engine (Groq) — Tasks 5, 8; large-file chunking (ffmpeg) — Task 4; timestamped transcript (verbose_json + merge) — Tasks 2, 5; summary (Claude) — Task 6; Google Doc via Drive conversion + `drive.file` scope — Task 7; `transcriptions` table — Task 1; pipeline orchestrator — Task 3; API routes (streaming upload + poll) — Task 9; UI + settings + landing — Tasks 8, 10; error handling (key preflight, per-step error, backoff) — Tasks 3, 9; setup docs — Task 8. All spec sections mapped.

**Placeholder scan:** no TBD/TODO; every code step carries full code; commands have expected output.

**Type consistency:** `ChunkResult`/`RawSegment`/`MergedSegment`/`PlannedChunk` defined in Task 2, consumed by Tasks 3, 5; `TranscriptionDeps`/`PreparedChunks` defined in Task 3, satisfied by the glue in Task 9 (`prepareChunks`/`transcribeChunk`/`summarize`/`createDoc` signatures match); `createTranscription(db, { originalFilename })` consistent across Tasks 3 and 9; status union (`uploading|transcribing|summarizing|creating_doc|done|error`) consistent across schema (Task 1), types (Task 1), orchestrator (Task 3), and UI labels (Task 10); `DRIVE_FILE_SCOPE` defined and consumed in Task 7.
