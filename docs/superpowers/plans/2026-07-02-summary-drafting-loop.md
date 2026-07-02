# Summary Drafting Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the transcriber's LinkedIn/Article summaries into an editable drafting loop — regenerate whole or selected spans, "like" a draft into memory as future inspiration, browse/reopen/clear/delete past transcriptions, and manage the style examples in settings.

**Architecture:** Style examples move from a hardcoded TS array into a `style_examples` SQLite table (seed + custom + liked rows). Core prompt builders take the example list as a parameter; a new core `style-examples` module owns all reads/writes. Web API routes gain regenerate/selection/save/clear/like/delete shapes and CRUD for examples. Three client components gain the new UI.

**Tech Stack:** Next.js (app router, `runtime = "nodejs"`), better-sqlite3 + drizzle-orm, TypeScript, vitest, lucide-react, Tailwind (house `anti-vibecode` tokens: `card`, `btn`, `btn-accent`, `eyebrow`, `text-ink`, `text-muted`, `text-danger`, `text-success`).

## Global Constraints

- No em dashes in any generated prompt copy or UI copy. Plain, factual copy.
- Formats are exactly `'linkedin'` and `'article'`. Example kinds are exactly `'seed' | 'custom' | 'liked'`.
- Liked examples fed to a prompt are capped at the most recent **3** per format; seed+custom are all included. Order: seed+custom (creation order) then last-3 liked (newest first).
- All DB writes to `transcriptions` set `updatedAt: Date.now()`.
- Migrations must be idempotent (guarded like existing `addColumnIfMissing`). Seeding never overwrites once a format has any row.
- No native `confirm()`/`alert()` dialogs in the browser (breaks the automation harness and violates house rules); use inline confirm affordances.
- Web imports core only via package subpaths (e.g. `@event-editor/core/style-examples`), extensionless. Turbopack: relative value imports inside web stay extensionless.
- Reuse existing house classes; every interactive action shows feedback (loading/disabled/error/success).

---

### Task 1: `style_examples` table, schema, migration + seed

**Files:**
- Modify: `packages/core/src/schema/index.ts` (add `styleExamples` table export)
- Modify: `packages/core/src/migrate.ts` (add DDL + `seedStyleExamples` in `runMigrations`)
- Test: `packages/core/test/style-examples-seed.test.ts` (create)

**Interfaces:**
- Produces: `styleExamples` drizzle table with columns `id, format, kind, text, createdAt`.
- Produces: `seedStyleExamples(db: BetterSQLite3Database<any>): void`.

- [ ] **Step 1: Add the table to the schema**

In `packages/core/src/schema/index.ts`, append:

```ts
export const styleExamples = sqliteTable("style_examples", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  format: text("format").notNull(), // linkedin|article
  kind: text("kind").notNull(),     // seed|custom|liked
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull().default(0),
});
```

- [ ] **Step 2: Add DDL + seed to migrate.ts**

In `packages/core/src/migrate.ts`, add to the `DDL` array (after the transcriptions CREATE TABLE):

```ts
  `CREATE TABLE IF NOT EXISTS style_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    format TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0
  )`,
```

Add an import at the top:

```ts
import { LINKEDIN_EXAMPLES, ARTICLE_EXAMPLES } from "./summary-examples.js";
```

Add the seed function above `runMigrations`:

```ts
export function seedStyleExamples(db: BetterSQLite3Database<any>): void {
  const seed = (format: "linkedin" | "article", texts: string[]) => {
    const rows = db.all(
      sql.raw(`SELECT COUNT(*) AS n FROM style_examples WHERE format = '${format}'`),
    ) as Array<{ n: number }>;
    if ((rows[0]?.n ?? 0) > 0) return;
    let now = Date.now();
    for (const t of texts) {
      const esc = t.replace(/'/g, "''");
      db.run(sql.raw(
        `INSERT INTO style_examples (format, kind, text, created_at) VALUES ('${format}', 'seed', '${esc}', ${now})`,
      ));
      now += 1; // preserve insertion order via distinct created_at
    }
  };
  seed("linkedin", LINKEDIN_EXAMPLES);
  seed("article", ARTICLE_EXAMPLES);
}
```

Call it at the end of `runMigrations`:

```ts
  addColumnIfMissing(db, "transcriptions", "summary_article", "TEXT");
  seedStyleExamples(db);
}
```

- [ ] **Step 3: Write the failing test**

`packages/core/test/style-examples-seed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { runMigrations, seedStyleExamples } from "../src/migrate";

function freshDb() {
  const sqlite = new Database(":memory:");
  return drizzle(sqlite);
}

describe("seedStyleExamples", () => {
  it("seeds built-in examples for both formats on first run", () => {
    const db = freshDb();
    runMigrations(db as any);
    const li = db.all(sql.raw("SELECT * FROM style_examples WHERE format='linkedin'")) as any[];
    const art = db.all(sql.raw("SELECT * FROM style_examples WHERE format='article'")) as any[];
    expect(li.length).toBeGreaterThan(0);
    expect(art.length).toBeGreaterThan(0);
    expect(li.every((r) => r.kind === "seed")).toBe(true);
  });

  it("does not re-seed when rows already exist", () => {
    const db = freshDb();
    runMigrations(db as any);
    const before = (db.all(sql.raw("SELECT COUNT(*) AS n FROM style_examples")) as any[])[0].n;
    seedStyleExamples(db as any);
    const after = (db.all(sql.raw("SELECT COUNT(*) AS n FROM style_examples")) as any[])[0].n;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @event-editor/core -- style-examples-seed`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema/index.ts packages/core/src/migrate.ts packages/core/test/style-examples-seed.test.ts
git commit -m "feat(core): style_examples table with seed migration"
```

---

### Task 2: Core `style-examples` module (CRUD + prompt selection)

**Files:**
- Create: `packages/core/src/style-examples.ts`
- Modify: `packages/core/package.json` (ensure the subpath export resolves — check `exports`/`typesVersions`; follow the pattern used by `transcribe`)
- Test: `packages/core/test/style-examples.test.ts`

**Interfaces:**
- Consumes: `styleExamples` table (Task 1).
- Produces:
  - `type Format = "linkedin" | "article"`
  - `type ExampleItem = { id: number; text: string }`
  - `listExamples(db, format): { seed: ExampleItem[]; custom: ExampleItem[]; liked: ExampleItem[] }`
  - `promptExamples(db, format): string[]`
  - `addExample(db, format, kind: "custom" | "liked", text): ExampleItem`
  - `updateExample(db, id: number, text): void`
  - `deleteExample(db, id: number): void`
  - `isLiked(db, format, text): boolean`
  - `toggleLiked(db, format, text): { liked: boolean }`

- [ ] **Step 1: Implement the module**

`packages/core/src/style-examples.ts`:

```ts
import { and, asc, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { styleExamples } from "./schema/index.js";

export type Format = "linkedin" | "article";
export type ExampleItem = { id: number; text: string };

const LIKED_PROMPT_CAP = 3;

type DB = BetterSQLite3Database<any>;

function rowsByKind(db: DB, format: Format, kind: string, order: "asc" | "desc") {
  const dir = order === "asc" ? asc(styleExamples.createdAt) : desc(styleExamples.createdAt);
  return db
    .select()
    .from(styleExamples)
    .where(and(eq(styleExamples.format, format), eq(styleExamples.kind, kind)))
    .orderBy(dir)
    .all()
    .map((r) => ({ id: r.id, text: r.text }));
}

export function listExamples(db: DB, format: Format) {
  return {
    seed: rowsByKind(db, format, "seed", "asc"),
    custom: rowsByKind(db, format, "custom", "asc"),
    liked: rowsByKind(db, format, "liked", "desc"),
  };
}

export function promptExamples(db: DB, format: Format): string[] {
  const seed = rowsByKind(db, format, "seed", "asc");
  const custom = rowsByKind(db, format, "custom", "asc");
  const liked = rowsByKind(db, format, "liked", "desc").slice(0, LIKED_PROMPT_CAP);
  return [...seed, ...custom, ...liked].map((r) => r.text);
}

export function addExample(db: DB, format: Format, kind: "custom" | "liked", text: string): ExampleItem {
  const res = db
    .insert(styleExamples)
    .values({ format, kind, text, createdAt: Date.now() })
    .run();
  return { id: Number(res.lastInsertRowid), text };
}

export function updateExample(db: DB, id: number, text: string): void {
  db.update(styleExamples).set({ text }).where(eq(styleExamples.id, id)).run();
}

export function deleteExample(db: DB, id: number): void {
  db.delete(styleExamples).where(eq(styleExamples.id, id)).run();
}

export function isLiked(db: DB, format: Format, text: string): boolean {
  const hit = db
    .select()
    .from(styleExamples)
    .where(and(eq(styleExamples.format, format), eq(styleExamples.kind, "liked"), eq(styleExamples.text, text)))
    .all();
  return hit.length > 0;
}

export function toggleLiked(db: DB, format: Format, text: string): { liked: boolean } {
  const existing = db
    .select()
    .from(styleExamples)
    .where(and(eq(styleExamples.format, format), eq(styleExamples.kind, "liked"), eq(styleExamples.text, text)))
    .all();
  if (existing.length > 0) {
    for (const row of existing) db.delete(styleExamples).where(eq(styleExamples.id, row.id)).run();
    return { liked: false };
  }
  addExample(db, format, "liked", text);
  return { liked: true };
}
```

- [ ] **Step 2: Confirm the subpath export**

Check `packages/core/package.json` `exports` (or `typesVersions`). If entries are enumerated per module, add `./style-examples` mirroring the `./transcribe` entry. If it's a wildcard (`./*`), no change needed. Run:

Run: `node -e "console.log(require('./packages/core/package.json').exports)"`
Expected: shows how subpaths resolve; add `./style-examples` if others are listed explicitly.

- [ ] **Step 3: Write the failing test**

`packages/core/test/style-examples.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { runMigrations } from "../src/migrate";
import { listExamples, promptExamples, addExample, updateExample, deleteExample, toggleLiked, isLiked } from "../src/style-examples";

function db() {
  const d = drizzle(new Database(":memory:"));
  runMigrations(d as any);
  return d as any;
}

describe("style-examples", () => {
  it("promptExamples returns seed+custom then last-3 liked", () => {
    const d = db();
    addExample(d, "linkedin", "custom", "CUSTOM1");
    for (let i = 1; i <= 5; i++) addExample(d, "linkedin", "liked", `LIKED${i}`);
    const out = promptExamples(d, "linkedin");
    expect(out).toContain("CUSTOM1");
    // only 3 most recent liked (LIKED5, LIKED4, LIKED3)
    const likedInOut = out.filter((t) => t.startsWith("LIKED"));
    expect(likedInOut.length).toBe(3);
    expect(likedInOut).toEqual(["LIKED5", "LIKED4", "LIKED3"]);
  });

  it("toggleLiked inserts then removes by text", () => {
    const d = db();
    expect(toggleLiked(d, "article", "DRAFT").liked).toBe(true);
    expect(isLiked(d, "article", "DRAFT")).toBe(true);
    expect(toggleLiked(d, "article", "DRAFT").liked).toBe(false);
    expect(isLiked(d, "article", "DRAFT")).toBe(false);
  });

  it("add/update/delete custom", () => {
    const d = db();
    const item = addExample(d, "linkedin", "custom", "A");
    updateExample(d, item.id, "B");
    expect(listExamples(d, "linkedin").custom.map((c) => c.text)).toContain("B");
    deleteExample(d, item.id);
    expect(listExamples(d, "linkedin").custom.map((c) => c.text)).not.toContain("B");
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @event-editor/core -- style-examples.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/style-examples.ts packages/core/package.json packages/core/test/style-examples.test.ts
git commit -m "feat(core): style-examples read/write module"
```

---

### Task 3: Prompt builders take examples + selection-rewrite builder

**Files:**
- Modify: `packages/core/src/transcribe.ts` (`buildLinkedInPrompt`, `buildArticlePrompt` signatures; add `buildSelectionRewritePrompt`)
- Modify: `packages/core/test/transcribe.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `buildLinkedInPrompt(transcript, details, examples: string[])`
  - `buildArticlePrompt(transcript, details, examples: string[])`
  - `buildSelectionRewritePrompt(format: "linkedin" | "article", fullDraft: string, selection: string, details: EventDetails, examples: string[]): { role: "user"; content: string }[]`

- [ ] **Step 1: Change the two builders to take `examples`**

In `packages/core/src/transcribe.ts`, remove the `import { LINKEDIN_EXAMPLES, ARTICLE_EXAMPLES } from "./summary-examples.js";` line (constants now only seed the DB via migrate.ts).

Change `buildLinkedInPrompt` signature and body:

```ts
export function buildLinkedInPrompt(
  transcript: string,
  details: EventDetails,
  examples: string[],
): { role: "user"; content: string }[] {
  const examplesBlock = examples.map((e, i) => `Example ${i + 1}:\n${e}`).join("\n\n---\n\n");
```

(keep the rest of the content string; the final line still appends `examplesBlock`). Rename the local `examples` const usage: the content already ends with `"Style examples:\n" + examples`; replace that with `"Style examples:\n" + examplesBlock`.

Do the same for `buildArticlePrompt` (param `examples: string[]`, local `examplesBlock`, and `"Style examples:\n" + examplesBlock`).

- [ ] **Step 2: Add the selection-rewrite builder**

Append to `transcribe.ts`:

```ts
export function buildSelectionRewritePrompt(
  format: "linkedin" | "article",
  fullDraft: string,
  selection: string,
  details: EventDetails,
  examples: string[],
): { role: "user"; content: string }[] {
  const examplesBlock = examples.map((e, i) => `Example ${i + 1}:\n${e}`).join("\n\n---\n\n");
  const kind = format === "linkedin" ? "LinkedIn post" : "article";
  const hashtagRule = format === "linkedin"
    ? "If the selection contains hashtags, write them plainly as #Topic, never the literal word hashtag. "
    : "Write any section header in bold using **Header**, never a Markdown number-sign header. ";
  return [
    {
      role: "user",
      content:
        `You are revising one selected passage of an existing ${kind} draft. ` +
        "Rewrite ONLY the selected passage so it reads better while keeping the same meaning, tone, " +
        "and the surrounding draft's style. Keep it roughly the same length and role in the draft. " +
        hashtagRule +
        "No em dashes. Only reference people and sponsors named in the details; do not invent names. " +
        "Return only the rewritten passage, with no preamble, quotes, or explanation.\n\n" +
        "Event details:\n" + detailsBlock(details) + "\n\n" +
        "Full draft (for context):\n" + fullDraft + "\n\n" +
        "Selected passage to rewrite:\n" + selection + "\n\n" +
        "Style examples:\n" + examplesBlock,
    },
  ];
}
```

- [ ] **Step 3: Update transcribe.test.ts**

Change the two builder calls to pass examples, and add a selection test. Replace the `buildLinkedInPrompt`/`buildArticlePrompt` describe blocks' first line:

```ts
    const text = buildLinkedInPrompt("TRANSCRIPT", DETAILS, ["EX_ONE"])[0].content;
```
```ts
    const text = buildArticlePrompt("TRANSCRIPT", DETAILS, ["EX_ONE"])[0].content;
```

Add assertions `expect(text).toContain("EX_ONE");` to each. Add:

```ts
import { buildSelectionRewritePrompt } from "../src/transcribe";

describe("buildSelectionRewritePrompt", () => {
  it("includes the selection, full draft, and format rules", () => {
    const text = buildSelectionRewritePrompt("linkedin", "FULL DRAFT", "THE SPAN", DETAILS, ["EX_ONE"])[0].content;
    expect(text).toContain("THE SPAN");
    expect(text).toContain("FULL DRAFT");
    expect(text).toContain("#Topic");
    expect(text).toContain("EX_ONE");
  });
  it("uses bold-header rule for article", () => {
    const text = buildSelectionRewritePrompt("article", "FULL", "SPAN", DETAILS, [])[0].content;
    expect(text).toContain("**Header**");
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @event-editor/core -- transcribe.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transcribe.ts packages/core/test/transcribe.test.ts
git commit -m "feat(core): prompt builders take examples; add selection-rewrite prompt"
```

---

### Task 4: Wire web anthropic.ts to DB examples + selection generation

**Files:**
- Modify: `packages/web/lib/anthropic.ts`
- Test: `packages/web/test/anthropic-summary.test.ts` (update)

**Interfaces:**
- Consumes: core `promptExamples`, `buildLinkedInPrompt`, `buildArticlePrompt`, `buildSelectionRewritePrompt`; `getDb`.
- Produces:
  - `generateFormattedSummary(client, format, transcript, details, examples: string[])` (examples now passed in by the caller/route)
  - `regenerateSelection(client, format, fullDraft, selection, details, examples): Promise<string>`

- [ ] **Step 1: Update imports and functions**

In `packages/web/lib/anthropic.ts`, extend the core import:

```ts
import { buildSummaryPrompt, buildEventDetailsPrompt, buildLinkedInPrompt, buildArticlePrompt, buildSelectionRewritePrompt, type EventDetails } from "@event-editor/core/transcribe";
```

Change `generateFormattedSummary` to accept `examples` and pass through:

```ts
export async function generateFormattedSummary(client: Anthropic, format: "linkedin" | "article", transcript: string, details: EventDetails, examples: string[]): Promise<string> {
  const messages = format === "linkedin" ? buildLinkedInPrompt(transcript, details, examples) : buildArticlePrompt(transcript, details, examples);
  const res: any = await client.messages.create({ model: SUMMARY_MODEL, max_tokens: 4096, messages } as any);
  if (res.stop_reason === "refusal") throw new Error(`model refused to write the ${format} summary`);
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  if (!text.trim()) throw new Error(`${format} model returned empty output`);
  return text.trim();
}

export async function regenerateSelection(client: Anthropic, format: "linkedin" | "article", fullDraft: string, selection: string, details: EventDetails, examples: string[]): Promise<string> {
  const messages = buildSelectionRewritePrompt(format, fullDraft, selection, details, examples);
  const res: any = await client.messages.create({ model: SUMMARY_MODEL, max_tokens: 2048, messages } as any);
  if (res.stop_reason === "refusal") throw new Error("model refused to rewrite the selection");
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  if (!text.trim()) throw new Error("selection rewrite returned empty output");
  return text.trim();
}
```

- [ ] **Step 2: Update anthropic-summary.test.ts**

The existing `generateFormattedSummary` test call becomes:

```ts
    const out = await generateFormattedSummary(client, "linkedin", "tx", details, ["EX"]);
```

Add a test:

```ts
import { regenerateSelection } from "../lib/anthropic";

describe("regenerateSelection", () => {
  it("returns the rewritten span text", async () => {
    const client = { messages: { create: vi.fn(async () => ({ content: [{ type: "text", text: "NEW SPAN" }] })) } } as any;
    const out = await regenerateSelection(client, "article", "FULL", "OLD SPAN", details, []);
    expect(out).toBe("NEW SPAN");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -w @event-editor/web -- anthropic-summary`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/lib/anthropic.ts packages/web/test/anthropic-summary.test.ts
git commit -m "feat(web): anthropic examples passthrough + selection rewrite"
```

---

### Task 5: Summary route — regenerate / selection / save + clear

**Files:**
- Modify: `packages/web/app/api/transcribe/[id]/summary/route.ts`
- Test: `packages/web/test/summary-route.test.ts` (create — unit-test the pure splice helper)

**Interfaces:**
- Consumes: `promptExamples` (core), `generateFormattedSummary`, `regenerateSelection`, `pickCachedSummary`.
- Produces: extended `POST` handler; new `DELETE` handler; exported pure helper `spliceSelection(draft, start, end, replacement): string`.

- [ ] **Step 1: Add the splice helper + failing test**

Create `packages/web/lib/summary-splice.ts`:

```ts
// Replace [start,end) in draft with replacement. Clamps out-of-range indices.
export function spliceSelection(draft: string, start: number, end: number, replacement: string): string {
  const a = Math.max(0, Math.min(start, draft.length));
  const b = Math.max(a, Math.min(end, draft.length));
  return draft.slice(0, a) + replacement + draft.slice(b);
}
```

`packages/web/test/summary-route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spliceSelection } from "../lib/summary-splice";

describe("spliceSelection", () => {
  it("replaces the selected span", () => {
    expect(spliceSelection("hello world", 6, 11, "there")).toBe("hello there");
  });
  it("clamps out-of-range indices", () => {
    expect(spliceSelection("abc", -5, 99, "X")).toBe("X");
  });
});
```

Run: `npm test -w @event-editor/web -- summary-route`
Expected: PASS.

- [ ] **Step 2: Rewrite the summary route**

`packages/web/app/api/transcribe/[id]/summary/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import type { EventDetails } from "@event-editor/core/transcribe";
import { promptExamples } from "@event-editor/core/style-examples";
import { getDb } from "@/lib/db";
import { visionClient, generateFormattedSummary, regenerateSelection } from "@/lib/anthropic";
import { pickCachedSummary, type SummaryFormat } from "@/lib/summary-format";
import { spliceSelection } from "@/lib/summary-splice";

export const runtime = "nodejs";

const EMPTY: EventDetails = { eventName: "", eventDescription: "", speakers: [], sponsors: [] };

function saveDraft(db: ReturnType<typeof getDb>, id: number, format: SummaryFormat, text: string) {
  const col = format === "linkedin" ? { summaryLinkedin: text } : { summaryArticle: text };
  db.update(transcriptions).set({ ...col, updatedAt: Date.now() }).where(eq(transcriptions.id, id)).run();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = Number(id);
  const body = await req.json().catch(() => ({}));
  const format = body.format as SummaryFormat;
  if (format !== "linkedin" && format !== "article") return NextResponse.json({ error: "bad format" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 400 });

  const db = getDb();
  const row = db.select().from(transcriptions).where(eq(transcriptions.id, nid)).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const details: EventDetails = row.eventDetails ? JSON.parse(row.eventDetails) : EMPTY;
  const examples = promptExamples(db, format);

  try {
    // Save a hand-edited draft.
    if (body.save === true && typeof body.draft === "string") {
      saveDraft(db, nid, format, body.draft);
      return NextResponse.json({ text: body.draft });
    }

    // Regenerate a selected span within the provided draft.
    if (typeof body.draft === "string" && Number.isInteger(body.selStart) && Number.isInteger(body.selEnd)) {
      const draft: string = body.draft;
      const selection = draft.slice(body.selStart, body.selEnd);
      if (!selection.trim()) return NextResponse.json({ error: "empty selection" }, { status: 400 });
      const rewritten = await regenerateSelection(visionClient(), format, draft, selection, details, examples);
      const next = spliceSelection(draft, body.selStart, body.selEnd, rewritten);
      saveDraft(db, nid, format, next);
      return NextResponse.json({ text: next });
    }

    // Whole-draft regenerate (bypass cache) or first-time generate.
    if (!row.transcriptText) return NextResponse.json({ error: "transcript not ready" }, { status: 409 });
    if (!body.regenerate) {
      const cached = pickCachedSummary(row as any, format);
      if (cached) return NextResponse.json({ text: cached });
    }
    const text = await generateFormattedSummary(visionClient(), format, row.transcriptText, details, examples);
    saveDraft(db, nid, format, text);
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "generation failed" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.update(transcriptions)
    .set({ summaryLinkedin: null, summaryArticle: null, updatedAt: Date.now() })
    .where(eq(transcriptions.id, Number(id)))
    .run();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "summary/route|summary-splice" || echo clean`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/api/transcribe/[id]/summary/route.ts packages/web/lib/summary-splice.ts packages/web/test/summary-route.test.ts
git commit -m "feat(web): summary route regenerate/selection/save/clear"
```

---

### Task 6: Like endpoint + liked flags on GET [id]

**Files:**
- Create: `packages/web/app/api/transcribe/[id]/like/route.ts`
- Modify: `packages/web/app/api/transcribe/[id]/route.ts` (add `likedLinkedin` / `likedArticle`)

**Interfaces:**
- Consumes: core `toggleLiked`, `isLiked`.
- Produces: `POST /api/transcribe/[id]/like {format}` -> `{liked}`; GET [id] returns liked flags.

- [ ] **Step 1: Like route**

`packages/web/app/api/transcribe/[id]/like/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import { toggleLiked } from "@event-editor/core/style-examples";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const format = body.format;
  if (format !== "linkedin" && format !== "article") return NextResponse.json({ error: "bad format" }, { status: 400 });
  const db = getDb();
  const row = db.select().from(transcriptions).where(eq(transcriptions.id, Number(id))).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const draft = format === "linkedin" ? row.summaryLinkedin : row.summaryArticle;
  if (!draft || !draft.trim()) return NextResponse.json({ error: "no draft to like" }, { status: 409 });
  const { liked } = toggleLiked(db, format, draft);
  return NextResponse.json({ liked });
}
```

- [ ] **Step 2: Liked flags on GET [id]**

In `packages/web/app/api/transcribe/[id]/route.ts`, import and compute:

```ts
import { isLiked } from "@event-editor/core/style-examples";
```

Add to the returned `transcription` object:

```ts
      likedLinkedin: !!row.summaryLinkedin && isLiked(getDb(), "linkedin", row.summaryLinkedin),
      likedArticle: !!row.summaryArticle && isLiked(getDb(), "article", row.summaryArticle),
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "like/route|transcribe/\[id\]/route" || echo clean`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/api/transcribe/[id]/like/route.ts packages/web/app/api/transcribe/[id]/route.ts
git commit -m "feat(web): like toggle endpoint + liked flags"
```

---

### Task 7: List all transcriptions + delete transcription

**Files:**
- Modify: `packages/web/app/api/transcribe/route.ts` (GET: drop limit, add flags)
- Modify: `packages/web/app/api/transcribe/[id]/route.ts` (add DELETE)

**Interfaces:**
- Produces: GET returns all rows with `hasLinkedin`/`hasArticle`; `DELETE /api/transcribe/[id]`.

- [ ] **Step 1: GET all + flags**

In `packages/web/app/api/transcribe/route.ts` GET, remove `.limit(5)`; map to include:

```ts
      hasLinkedin: !!r.summaryLinkedin,
      hasArticle: !!r.summaryArticle,
```

Update the comment `// The 5 most recent...` to `// All transcriptions, newest first, for the history panel.`

- [ ] **Step 2: DELETE transcription**

Add to `packages/web/app/api/transcribe/[id]/route.ts`:

```ts
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = Number(id);
  const db = getDb();
  db.delete(transcriptions).where(eq(transcriptions.id, nid)).run();
  // Best-effort cleanup of the upload dir; ignore if absent.
  await rm(resolve("data/uploads", String(nid)), { recursive: true, force: true }).catch(() => {});
  return NextResponse.json({ ok: true });
}
```

(Ensure `transcriptions` and `eq` are already imported in this file — they are.)

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "transcribe/route|transcribe/\[id\]/route" || echo clean`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/api/transcribe/route.ts packages/web/app/api/transcribe/[id]/route.ts
git commit -m "feat(web): list all transcriptions + delete endpoint"
```

---

### Task 8: Style-examples CRUD routes

**Files:**
- Create: `packages/web/app/api/style-examples/route.ts` (GET list, POST add)
- Create: `packages/web/app/api/style-examples/[id]/route.ts` (PATCH edit, DELETE remove)

**Interfaces:**
- Consumes: core `listExamples`, `addExample`, `updateExample`, `deleteExample`.
- Produces: the four endpoints in the spec.

- [ ] **Step 1: List + add**

`packages/web/app/api/style-examples/route.ts`:

```ts
import { NextResponse } from "next/server";
import { listExamples, addExample, type Format } from "@event-editor/core/style-examples";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

function parseFormat(v: string | null): Format | null {
  return v === "linkedin" || v === "article" ? v : null;
}

export async function GET(req: Request) {
  const format = parseFormat(new URL(req.url).searchParams.get("format"));
  if (!format) return NextResponse.json({ error: "bad format" }, { status: 400 });
  return NextResponse.json(listExamples(getDb(), format));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const format = parseFormat(body.format);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!format) return NextResponse.json({ error: "bad format" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
  const item = addExample(getDb(), format, "custom", text);
  return NextResponse.json(item);
}
```

- [ ] **Step 2: Edit + delete**

`packages/web/app/api/style-examples/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { updateExample, deleteExample } from "@event-editor/core/style-examples";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
  updateExample(getDb(), Number(id), text);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteExample(getDb(), Number(id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "style-examples" || echo clean`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/api/style-examples
git commit -m "feat(web): style-examples CRUD routes"
```

---

### Task 9: One-off cleanup of stored summaries

**Files:**
- None committed (a run-once maintenance action).

- [ ] **Step 1: Run the cleanup against the dev DB**

Run:
```bash
cd ~/event-editor && node -e "
const { openDb } = require('./packages/core/dist/db.js');
" 2>/dev/null || true
```
If core isn't pre-built for require, use the drizzle-free direct path instead:

```bash
cd ~/event-editor && node -e "
const Database = require('better-sqlite3');
const db = new Database(process.env.EE_DB_PATH || './data/app.db');
const info = db.prepare(\"SELECT count(*) n FROM sqlite_master WHERE name='transcriptions'\").get();
if (info.n) { const r = db.prepare('UPDATE transcriptions SET summary_linkedin=NULL, summary_article=NULL').run(); console.log('cleared drafts on', r.changes, 'rows'); }
else { console.log('no transcriptions table'); }
db.close();
"
```
Expected: prints `cleared drafts on N rows` (N may be 0 if none cached).

- [ ] **Step 2: No commit** (data-only change). Note completion in the task tracker.

---

### Task 10: Draft panel UI — edit/preview, regenerate all/selection, like

**Files:**
- Modify: `packages/web/app/transcribe/TranscribeClient.tsx`
- Modify: `packages/web/components/CopyButton.tsx` (no change expected; verify it accepts `html`)

**Interfaces:**
- Consumes: summary route shapes (Task 5), like route (Task 6), `summaryToHtml`/`summaryToPlain`, `Segmented`, `CopyButton`.
- Produces: `onOpen(id)`-compatible loader used by Task 11 (`loadExisting(id: number)`).

Behavior to implement (the draft-panel block currently at ~lines 204-229):

- [ ] **Step 1: State + loader**

Add state near the other `useState`s:

```ts
const [draftMode, setDraftMode] = useState<"edit" | "preview">("preview");
const [liked, setLiked] = useState<{ linkedin: boolean; article: boolean }>({ linkedin: false, article: false });
const [selRange, setSelRange] = useState<{ start: number; end: number } | null>(null);
const [actionBusy, setActionBusy] = useState(false);
const draftRef = useRef<HTMLTextAreaElement | null>(null);
```

Add a `loadExisting` function that Task 11 calls when the user opens a past transcription:

```ts
async function loadExisting(openId: number) {
  setId(openId);
  setFormat("general");
  setFormatText({});
  setUploadError(null);
  try {
    const r = await fetch(`/api/transcribe/${openId}`);
    const d = await r.json().catch(() => null);
    const t = d?.transcription;
    if (!t) return;
    setTx({ ...t });
    setFormatText({
      ...(t.summaryLinkedin ? { linkedin: t.summaryLinkedin } : {}),
      ...(t.summaryArticle ? { article: t.summaryArticle } : {}),
    });
    setLiked({ linkedin: !!t.likedLinkedin, article: !!t.likedArticle });
  } catch { /* ignore */ }
}
```

Note: confirm the `Transcription` type/`tx` shape includes the summary fields; extend the local interface with `summaryLinkedin?: string | null; summaryArticle?: string | null; likedLinkedin?: boolean; likedArticle?: boolean` as needed.

- [ ] **Step 2: Draft actions**

```ts
async function regenerateAll(fmt: "linkedin" | "article") {
  if (id == null) return;
  setActionBusy(true); setFormatError(null);
  try {
    const r = await fetch(`/api/transcribe/${id}/summary`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: fmt, regenerate: true }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.text) { setFormatText((m) => ({ ...m, [fmt]: d.text })); setLiked((l) => ({ ...l, [fmt]: false })); }
    else setFormatError(d?.error ?? "Could not regenerate.");
  } catch { setFormatError("Could not regenerate."); }
  finally { setActionBusy(false); }
}

async function regenerateSelection(fmt: "linkedin" | "article") {
  if (id == null || !selRange || selRange.end <= selRange.start) return;
  const draft = formatText[fmt] ?? "";
  setActionBusy(true); setFormatError(null);
  try {
    const r = await fetch(`/api/transcribe/${id}/summary`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: fmt, draft, selStart: selRange.start, selEnd: selRange.end }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.text) { setFormatText((m) => ({ ...m, [fmt]: d.text })); setLiked((l) => ({ ...l, [fmt]: false })); setSelRange(null); }
    else setFormatError(d?.error ?? "Could not regenerate the selection.");
  } catch { setFormatError("Could not regenerate the selection."); }
  finally { setActionBusy(false); }
}

async function saveEdits(fmt: "linkedin" | "article") {
  if (id == null) return;
  const draft = formatText[fmt] ?? "";
  await fetch(`/api/transcribe/${id}/summary`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ format: fmt, draft, save: true }),
  }).catch(() => {});
  setLiked((l) => ({ ...l, [fmt]: false })); // edited text is no longer the liked text
}

async function toggleLike(fmt: "linkedin" | "article") {
  if (id == null) return;
  await saveEdits(fmt); // ensure the saved draft matches what is on screen
  const r = await fetch(`/api/transcribe/${id}/like`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ format: fmt }),
  });
  const d = await r.json().catch(() => null);
  if (r.ok) setLiked((l) => ({ ...l, [fmt]: !!d.liked }));
}
```

- [ ] **Step 3: Render the panel (replace the `format !== "general"` success branch)**

Requirements for the JSX (use house classes; no em dashes in copy):
- A small `Segmented` (or two buttons) for `draftMode` Edit/Preview above the draft.
- Preview: `<div className="text-ink" dangerouslySetInnerHTML={{ __html: summaryToHtml(formatText[format] ?? "") }} />` (existing).
- Edit: a `<textarea ref={draftRef} className="w-full min-h-[220px] ...">` bound to `formatText[format]`, `onChange` updates `formatText`, `onSelect`/`onKeyUp`/`onMouseUp` set `selRange` from `draftRef.current.selectionStart/End`, `onBlur` calls `saveEdits(format)`.
- Actions row (only when `formatText[format]`): `Regenerate all` (btn, disabled while `actionBusy`, spinner label "Regenerating!"), `Regenerate selection` (btn, disabled unless `draftMode==="edit"` and `selRange` non-empty), `CopyButton text={summaryToPlain(formatText[format]!)} html={summaryToHtml(formatText[format]!)}`, and the Like smiley.
- Like smiley: a `<button title="Mark this draft as good. Future drafts will use it as inspiration.">` containing lucide `Smile`, `className` accent when `liked[format]`. On click `toggleLike(format)`.
- Keep the existing `formatBusy` (first load) and `formatError` + Try again handling.

Example actions row:

```tsx
<div className="mt-3 flex flex-wrap items-center gap-2">
  <button className="btn" onClick={() => regenerateAll(format as "linkedin"|"article")} disabled={actionBusy}>
    {actionBusy ? "Regenerating!" : "Regenerate all"}
  </button>
  <button className="btn" onClick={() => regenerateSelection(format as "linkedin"|"article")}
    disabled={actionBusy || draftMode !== "edit" || !selRange || selRange.end <= selRange.start}>
    Regenerate selection
  </button>
  <CopyButton text={summaryToPlain(formatText[format]!)} html={summaryToHtml(formatText[format]!)} />
  <button type="button" title="Mark this draft as good. Future drafts will use it as inspiration."
    aria-pressed={liked[format as "linkedin"|"article"]}
    className={`btn inline-flex items-center gap-2 ${liked[format as "linkedin"|"article"] ? "text-accent" : ""}`}
    onClick={() => toggleLike(format as "linkedin"|"article")}>
    <Smile className="w-4 h-4" />
  </button>
</div>
```

Add `import { Smile } from "lucide-react";` at the top.

- [ ] **Step 4: Verify build + typecheck**

Run: `cd packages/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "TranscribeClient" || echo clean`
Expected: `clean`.
Run: `npm test -w @event-editor/web -- render-summary transcribe-format` (regression) -> PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/transcribe/TranscribeClient.tsx
git commit -m "feat(web): editable draft panel with regenerate/selection/like"
```

---

### Task 11: Past-transcriptions popover — all rows, open/clear/delete

**Files:**
- Modify: `packages/web/app/transcribe/PastTranscriptions.tsx`
- Modify: `packages/web/app/transcribe/TranscribeClient.tsx` (render `<PastTranscriptions onOpen={loadExisting} />`)
- Modify: `packages/web/app/transcribe/page.tsx` if the popover is mounted there instead (verify where it renders)

**Interfaces:**
- Consumes: `loadExisting(id)` (Task 10), GET `/api/transcribe`, `DELETE /api/transcribe/[id]`, `DELETE /api/transcribe/[id]/summary`.

- [ ] **Step 1: Find where PastTranscriptions is mounted**

Run: `grep -rn "PastTranscriptions" packages/web/app | grep -v ".next"`
Wire an `onOpen?: (id: number) => void` prop through to whatever mounts it, ultimately from `TranscribeClient` so `loadExisting` is in scope. If it is mounted in `page.tsx` (a server component) separately from `TranscribeClient`, lift the mount into `TranscribeClient` so the callback can be passed.

- [ ] **Step 2: Update the component**

Extend `Item` with `hasLinkedin: boolean; hasArticle: boolean`. Accept `{ onOpen }: { onOpen: (id: number) => void }`. For each row add an actions cluster:

- `Open` button -> `onOpen(it.id); setOpen(false);`
- `Clear drafts` button -> `await fetch(\`/api/transcribe/${it.id}/summary\`, { method: "DELETE" })` then refresh the list (re-run the same fetch as `toggle`), disable while in-flight.
- `Delete` with inline confirm: a per-row `confirmingId` state; first click sets `confirmingId=it.id` and shows "Delete? Yes / No"; "Yes" -> `await fetch(\`/api/transcribe/${it.id}\`, { method: "DELETE" })` then refresh; "No" clears `confirmingId`. No native `confirm()`.
- Show small chips when `hasLinkedin` / `hasArticle` ("LinkedIn", "Article") using `text-muted` text.

Refactor the list-load into a `reload()` function reused by `toggle` and after each mutation.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev` (from repo root), open `http://localhost:3000/transcribe`, open the popover:
Expected: all transcriptions listed; Open loads one into the main view with its LinkedIn/Article drafts available; Clear drafts empties them; Delete (after confirm) removes the row.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/transcribe/PastTranscriptions.tsx packages/web/app/transcribe/TranscribeClient.tsx packages/web/app/transcribe/page.tsx
git commit -m "feat(web): past transcriptions open/clear/delete, show all"
```

---

### Task 12: Settings — draft style & inspiration section

**Files:**
- Create: `packages/web/app/settings/StyleExamples.tsx` (client component)
- Modify: `packages/web/app/settings/page.tsx` (render the new section)

**Interfaces:**
- Consumes: `/api/style-examples` GET/POST, `/api/style-examples/[id]` PATCH/DELETE.

- [ ] **Step 1: Client component**

`packages/web/app/settings/StyleExamples.tsx` (`"use client"`). For each format tab (LinkedIn, Article):
- Fetch `GET /api/style-examples?format=...` on mount / tab switch into `{ seed, custom, liked }`.
- Render seed+custom as editable rows: a `<textarea>` bound to local edit state + `Save` (PATCH) + `Delete` (DELETE, inline confirm, no native dialog).
- Render liked drafts as read text with a `Remove` (DELETE) button.
- `Add example`: a textarea + `Add` (POST custom), then reload.
- All actions show loading/disabled/error feedback; success is reflected by the list updating.

Use house classes (`card`, `btn`, `btn-accent`, `eyebrow`, `text-ink`, `text-muted`, `text-danger`). Copy in sentence case, no em dashes. Example heading copy: eyebrow "Draft style and inspiration", helper "Examples the summary writer imitates. Liked drafts are added automatically and used as extra inspiration."

- [ ] **Step 2: Mount in settings**

In `packages/web/app/settings/page.tsx`, add after the Connections section:

```tsx
      <h2 className="mt-10 text-lg font-semibold">Draft style and inspiration</h2>
      <StyleExamples />
```

and `import { StyleExamples } from "./StyleExamples";`.

- [ ] **Step 3: Manual smoke**

Run: dev server, open `http://localhost:3000/settings`:
Expected: both formats list built-in examples; can add/edit/delete a custom example; liked drafts (if any) appear with Remove.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/settings/StyleExamples.tsx packages/web/app/settings/page.tsx
git commit -m "feat(web): editable style examples + liked drafts in settings"
```

---

## Final verification

- [ ] Run full suites: `npm test -w @event-editor/core` and `npm test -w @event-editor/web` — all green.
- [ ] `cd packages/web && npx tsc --noEmit -p tsconfig.json` — no new errors in changed files (pre-existing errors in `test/canva-oauth.test.ts` and `test/docs.test.ts` are unrelated and may remain).
- [ ] Dev-server walk: upload/open a transcription, generate LinkedIn + Article, regenerate all, select a span and regenerate it, edit + save, like/unlike, then confirm the liked draft shows in Settings and Clear drafts / Delete work in the popover.
- [ ] Whole-branch review, then push to `main`.
