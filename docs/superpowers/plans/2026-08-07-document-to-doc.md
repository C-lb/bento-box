# Document to doc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `/transcribe` accept a document (dragged file or picked Google Doc) and produce the same Summary / LinkedIn post / Article output, writing into a new tab inside the source document when the source is a Google Doc.

**Architecture:** One neutral section model (`DocSection[]`) built by `buildDocSections`, consumed by two pure renderers: the existing HTML string builder for Drive import, and a new `buildTabRequests` that emits Google Docs API `batchUpdate` requests. A `runDocumentSummary` pipeline sits beside `runTranscription`, sharing its injected deps minus the audio stages.

**Tech Stack:** TypeScript, Next.js 16 (App Router), drizzle-orm + better-sqlite3, vitest, googleapis (Drive v3 + Docs v1), officeparser, Anthropic SDK.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-document-to-doc-design.md`. Read it before starting.
- Monorepo: `packages/core` (pure logic, vitest) and `packages/web` (Next app, vitest). Core must stay free of Next and Google imports.
- Core is consumed by web through built `dist/`. After changing core, run `npm -w @event-editor/core run build` before web tests that import it.
- Run core tests with `npm -w @event-editor/core run test`, web tests with `npm -w @event-editor/web run test`.
- New DB columns go through `addColumnIfMissing` in `packages/core/src/migrate.ts`, never a destructive migration. Existing rows must keep working with the column null.
- Any new export from core must be added to `packages/core/src/index.ts` (it re-exports `./transcribe.js` and `./transcription.js` with `export *`, so exports from those two files are automatic).
- Prompts must not use em dashes. The existing `buildSummaryPrompt` says so explicitly; keep that rule in the new prompt.
- Size cap on extracted document text: **400,000 characters**. Over the cap is an error, never a truncation.
- The tab written into a picked Google Doc is titled **"Summary"**.
- UI work goes through the `anti-vibecode` skill. Do not hand-roll new button or field styles.
- One task, one commit. Commit at the end of every task.

---

### Task 1: Section model and HTML renderer refactor

Introduces the neutral `DocSection[]` model and reshapes `buildDocHtml` to consume it. Output for audio rows must be byte-identical to today.

**Files:**
- Modify: `packages/core/src/transcribe.ts`
- Modify: `packages/core/src/transcription.ts` (caller)
- Modify: `packages/web/lib/doc-sync.ts` (caller)
- Test: `packages/core/test/transcribe.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `type DocSourceKind = "audio" | "document" | "gdoc"`
  - `type DocBody = { kind: "paras"; text: string } | { kind: "segments"; segments: MergedSegment[] }`
  - `type DocSection = { heading: string; body: DocBody }`
  - `function buildDocSections(input: DocSectionInput): DocSection[]`
  - `type DocSectionInput = { sourceKind: DocSourceKind | null; summary: string; linkedin?: string | null; article?: string | null; segments?: MergedSegment[]; sourceText?: string | null }`
  - `function buildDocHtml(sections: DocSection[]): string`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/transcribe.test.ts`:

```ts
import { buildDocSections, type DocSection } from "../src/transcribe.js";

describe("buildDocSections", () => {
  const base = { summary: "the summary", segments: [{ startSec: 0, text: "hello" }] };

  it("gives an audio row a timestamped Transcript section last", () => {
    const s = buildDocSections({ ...base, sourceKind: "audio" });
    expect(s.map((x) => x.heading)).toEqual(["Summary", "Transcript"]);
    expect(s[1].body).toEqual({ kind: "segments", segments: [{ startSec: 0, text: "hello" }] });
  });

  it("treats a null sourceKind as audio so old rows keep working", () => {
    const s = buildDocSections({ ...base, sourceKind: null });
    expect(s.map((x) => x.heading)).toEqual(["Summary", "Transcript"]);
  });

  it("gives a dragged document a plain Source document section last", () => {
    const s = buildDocSections({
      sourceKind: "document",
      summary: "the summary",
      sourceText: "para one\n\npara two",
    });
    expect(s.map((x) => x.heading)).toEqual(["Summary", "Source document"]);
    expect(s[1].body).toEqual({ kind: "paras", text: "para one\n\npara two" });
  });

  it("gives a gdoc row no source section at all", () => {
    const s = buildDocSections({
      sourceKind: "gdoc",
      summary: "the summary",
      sourceText: "ignored",
    });
    expect(s.map((x) => x.heading)).toEqual(["Summary"]);
  });

  it("places drafts between the summary and the source", () => {
    const s = buildDocSections({
      ...base,
      sourceKind: "audio",
      linkedin: "the post",
      article: "the article",
    });
    expect(s.map((x) => x.heading)).toEqual([
      "Summary", "LinkedIn post", "Article", "Transcript",
    ]);
  });

  it("omits drafts that are null or empty", () => {
    const s = buildDocSections({ ...base, sourceKind: "audio", linkedin: "", article: null });
    expect(s.map((x) => x.heading)).toEqual(["Summary", "Transcript"]);
  });
});

describe("buildDocHtml over sections", () => {
  it("renders headings and paragraphs, escaping the text", () => {
    const sections: DocSection[] = [
      { heading: "Summary", body: { kind: "paras", text: "a & b" } },
      { heading: "Transcript", body: { kind: "segments", segments: [{ startSec: 61, text: "hi" }] } },
    ];
    expect(buildDocHtml(sections)).toBe(
      "<h1>Summary</h1><p>a &amp; b</p><h1>Transcript</h1><p>[00:01:01] hi</p>",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm -w @event-editor/core run test -- transcribe`
Expected: FAIL, `buildDocSections is not a function`, plus `buildDocHtml` arity failures.

- [ ] **Step 3: Implement the model and the renderer**

In `packages/core/src/transcribe.ts`, replace the existing `DocDrafts` / `buildDocHtml` / `buildTranscriptHtml` block with:

```ts
export type DocSourceKind = "audio" | "document" | "gdoc";

export type DocBody =
  | { kind: "paras"; text: string }
  | { kind: "segments"; segments: MergedSegment[] };

export type DocSection = { heading: string; body: DocBody };

export interface DocSectionInput {
  sourceKind: DocSourceKind | null;
  summary: string;
  linkedin?: string | null;
  article?: string | null;
  segments?: MergedSegment[];
  sourceText?: string | null;
}

// The single place that decides which sections a generated doc has.
// A gdoc row gets no source section: the original is the sibling tab in the
// same file, so copying it in would be pure duplication.
export function buildDocSections(input: DocSectionInput): DocSection[] {
  const sections: DocSection[] = [
    { heading: "Summary", body: { kind: "paras", text: input.summary } },
  ];
  if (input.linkedin) {
    sections.push({ heading: "LinkedIn post", body: { kind: "paras", text: input.linkedin } });
  }
  if (input.article) {
    sections.push({ heading: "Article", body: { kind: "paras", text: input.article } });
  }
  const kind = input.sourceKind ?? "audio";
  if (kind === "audio") {
    sections.push({ heading: "Transcript", body: { kind: "segments", segments: input.segments ?? [] } });
  } else if (kind === "document" && input.sourceText) {
    sections.push({ heading: "Source document", body: { kind: "paras", text: input.sourceText } });
  }
  return sections;
}

/** Plain-text paragraphs of a section body, one string per paragraph. Shared
 *  by both renderers so HTML and Docs output can't drift. */
export function sectionParagraphs(body: DocBody): string[] {
  if (body.kind === "segments") {
    return body.segments.map((seg) => `[${formatTimestamp(seg.startSec)}] ${seg.text}`);
  }
  return body.text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function buildDocHtml(sections: DocSection[]): string {
  return sections
    .map((s) => {
      const paras = sectionParagraphs(s.body).map((p) => `<p>${escapeHtml(p)}</p>`).join("");
      return `<h1>${escapeHtml(s.heading)}</h1>${paras}`;
    })
    .join("");
}
```

Delete the now-unused `textParas` helper and the `DocDrafts` type. Keep `escapeHtml` and `formatTimestamp`.

- [ ] **Step 4: Update the two callers**

In `packages/core/src/transcription.ts`, change the import to drop `buildTranscriptHtml` and add `buildDocSections, buildDocHtml`, then replace the doc-building line:

```ts
const html = buildDocHtml(
  buildDocSections({ sourceKind: "audio", summary, segments, linkedin: null, article: null }),
);
```

In `packages/web/lib/doc-sync.ts`, replace the `buildDocHtml` call:

```ts
const html = buildDocHtml(
  buildDocSections({
    sourceKind: "audio",
    summary: row.summaryText,
    linkedin: row.summaryLinkedin,
    article: row.summaryArticle,
    segments: segmentsOf(row),
  }),
);
```

and update its import to `import { buildDocSections, buildDocHtml, type MergedSegment } from "@event-editor/core/transcribe";`.

- [ ] **Step 5: Fix the existing tests that used the old signature**

`packages/core/test/transcribe.test.ts` has `buildTranscriptHtml` and old-signature `buildDocHtml` tests. Rewrite each to build sections first. Do not delete the assertions: the point is proving audio output is unchanged.

- [ ] **Step 6: Run all core and web tests**

Run: `npm -w @event-editor/core run test && npm -w @event-editor/core run build && npm -w @event-editor/web run test`
Expected: PASS. If `packages/web/test/transcribe-format.test.ts` references the old signature, update it the same way.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/transcribe.ts packages/core/src/transcription.ts packages/core/test/transcribe.test.ts packages/web/lib/doc-sync.ts packages/web/test/
git commit -m "refactor: build docs from a neutral section model"
```

---

### Task 2: `buildTabRequests`, the Docs API renderer

The risky one. Index arithmetic against the Docs API. Tested through a simulator so the test can actually fail.

**Files:**
- Modify: `packages/core/src/transcribe.ts`
- Test: `packages/core/test/tab-requests.test.ts` (create)

**Interfaces:**
- Consumes: `DocSection`, `sectionParagraphs` from Task 1.
- Produces: `function buildTabRequests(sections: DocSection[], tabId: string): TabRequest[]` and `type TabRequest` (a structural type, not the googleapis one, so core stays dependency-free).

- [ ] **Step 1: Write the failing test with an apply-model**

Create `packages/core/test/tab-requests.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTabRequests, type DocSection, type TabRequest } from "../src/transcribe.js";

// A tiny model of a Google Doc tab: text plus the ranges marked as headings.
// Running the real requests through this is what makes the test falsifiable.
// Asserting on the request literals instead would just restate the code.
function applyRequests(requests: TabRequest[], tabId: string) {
  let text = "";
  const headings: string[] = [];
  for (const req of requests) {
    if (req.insertText) {
      expect(req.insertText.location.tabId).toBe(tabId);
      const at = req.insertText.location.index - 1; // body content starts at index 1
      text = text.slice(0, at) + req.insertText.text + text.slice(at);
    } else if (req.updateParagraphStyle) {
      const r = req.updateParagraphStyle.range;
      expect(r.tabId).toBe(tabId);
      expect(req.updateParagraphStyle.paragraphStyle.namedStyleType).toBe("HEADING_1");
      headings.push(text.slice(r.startIndex - 1, r.endIndex - 1));
    }
  }
  return { text, headings };
}

const sections: DocSection[] = [
  { heading: "Summary", body: { kind: "paras", text: "first para\n\nsecond para" } },
  { heading: "LinkedIn post", body: { kind: "paras", text: "the post" } },
];

describe("buildTabRequests", () => {
  it("produces a tab whose text is the sections in order", () => {
    const { text } = applyRequests(buildTabRequests(sections, "t.1"), "t.1");
    expect(text).toBe(
      "Summary\nfirst para\nsecond para\nLinkedIn post\nthe post\n",
    );
  });

  it("marks exactly the heading paragraphs as headings", () => {
    const { headings } = applyRequests(buildTabRequests(sections, "t.1"), "t.1");
    expect(headings).toEqual(["Summary\n", "LinkedIn post\n"]);
  });

  it("keeps heading ranges correct when a body has many paragraphs", () => {
    const many: DocSection[] = [
      { heading: "Summary", body: { kind: "paras", text: "a\n\nb\n\nc\n\nd" } },
      { heading: "Article", body: { kind: "paras", text: "e" } },
    ];
    const { headings } = applyRequests(buildTabRequests(many, "t.2"), "t.2");
    expect(headings).toEqual(["Summary\n", "Article\n"]);
  });

  it("renders timestamped segments", () => {
    const s: DocSection[] = [
      { heading: "Transcript", body: { kind: "segments", segments: [{ startSec: 0, text: "hi" }, { startSec: 61, text: "there" }] } },
    ];
    const { text } = applyRequests(buildTabRequests(s, "t.3"), "t.3");
    expect(text).toBe("Transcript\n[00:00:00] hi\n[00:01:01] there\n");
  });

  it("emits no requests for no sections", () => {
    expect(buildTabRequests([], "t.4")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @event-editor/core run test -- tab-requests`
Expected: FAIL, `buildTabRequests is not a function`.

- [ ] **Step 3: Implement**

Append to `packages/core/src/transcribe.ts`:

```ts
/** Structural subset of the Docs API request shapes we emit. Declared here so
 *  core needs no googleapis dependency; the web layer passes these straight to
 *  documents.batchUpdate. */
export type TabRequest =
  | { insertText: { location: { index: number; tabId: string }; text: string } }
  | {
      updateParagraphStyle: {
        range: { startIndex: number; endIndex: number; tabId: string };
        paragraphStyle: { namedStyleType: string };
        fields: string;
      };
    };

// A tab's body content starts at index 1, not 0.
const TAB_BODY_START = 1;

export function buildTabRequests(sections: DocSection[], tabId: string): TabRequest[] {
  let text = "";
  const headings: { start: number; end: number }[] = [];
  for (const section of sections) {
    const start = text.length;
    text += section.heading + "\n";
    // The range covers the trailing newline: a Docs paragraph includes it, and
    // paragraph styling applies to whole paragraphs the range touches.
    headings.push({ start, end: text.length });
    for (const para of sectionParagraphs(section.body)) text += para + "\n";
  }
  if (!text) return [];
  return [
    { insertText: { location: { index: TAB_BODY_START, tabId }, text } },
    ...headings.map((h) => ({
      updateParagraphStyle: {
        range: {
          startIndex: TAB_BODY_START + h.start,
          endIndex: TAB_BODY_START + h.end,
          tabId,
        },
        paragraphStyle: { namedStyleType: "HEADING_1" },
        fields: "namedStyleType",
      },
    })),
  ];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w @event-editor/core run test -- tab-requests`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation-check the test**

This repo has shipped three tests that could not fail. Prove this one can.

Change `TAB_BODY_START` from `1` to `0`, run the test, confirm RED. Restore it, confirm GREEN.
Then change `headings.push({ start, end: text.length })` to `{ start, end: text.length - 1 }`, run, confirm RED. Restore, confirm GREEN.

If either mutation stays green, the test is not measuring what it claims and must be fixed before moving on.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/transcribe.ts packages/core/test/tab-requests.test.ts
git commit -m "feat: render doc sections as Google Docs API tab requests"
```

---

### Task 3: Schema columns

**Files:**
- Modify: `packages/core/src/schema/index.ts:69-88`
- Modify: `packages/core/src/migrate.ts:218-223`
- Test: `packages/core/test/migrate-document-columns.test.ts` (create)

**Interfaces:**
- Produces: `transcriptions.sourceKind`, `transcriptions.sourceDocId`, `transcriptions.docTabId` on the drizzle table.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/migrate-document-columns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, transcriptions, createTranscription } from "../src/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-doccols-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

describe("document source columns", () => {
  it("defaults to null on a new row so old rows read as audio", () => {
    const db = freshDb();
    const id = createTranscription(db, { originalFilename: "talk.mp3" });
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.sourceKind).toBeNull();
    expect(row.sourceDocId).toBeNull();
    expect(row.docTabId).toBeNull();
  });

  it("round-trips a gdoc row", () => {
    const db = freshDb();
    const id = createTranscription(db, { originalFilename: "board pack" });
    db.update(transcriptions)
      .set({ sourceKind: "gdoc", sourceDocId: "doc123", docTabId: "t.abc" })
      .where(eq(transcriptions.id, id))
      .run();
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.sourceKind).toBe("gdoc");
    expect(row.sourceDocId).toBe("doc123");
    expect(row.docTabId).toBe("t.abc");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @event-editor/core run test -- migrate-document-columns`
Expected: FAIL, `no such column: source_kind`.

- [ ] **Step 3: Add the columns**

In `packages/core/src/schema/index.ts`, inside the `transcriptions` table after `transcriptSegments`:

```ts
  sourceKind: text("source_kind"),        // audio|document|gdoc; null reads as audio
  sourceDocId: text("source_doc_id"),     // Google Doc a tab was written into
  docTabId: text("doc_tab_id"),           // the tab we own inside that doc
```

In `packages/core/src/migrate.ts`, beside the existing `addColumnIfMissing` calls:

```ts
  addColumnIfMissing(db, "transcriptions", "source_kind", "TEXT");
  addColumnIfMissing(db, "transcriptions", "source_doc_id", "TEXT");
  addColumnIfMissing(db, "transcriptions", "doc_tab_id", "TEXT");
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm -w @event-editor/core run test -- migrate-document-columns`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema/index.ts packages/core/src/migrate.ts packages/core/test/migrate-document-columns.test.ts
git commit -m "feat: add source kind and tab columns to transcriptions"
```

---

### Task 4: Document text extraction

Extends the existing context-file parser with txt and docx, adds the size cap, and fixes doc naming.

**Files:**
- Modify: `packages/web/lib/context.ts`
- Modify: `packages/core/src/transcribe.ts` (`docBaseName`)
- Test: `packages/web/test/document-extract.test.ts` (create)
- Test: `packages/core/test/transcribe.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type DocumentExt = "txt" | "md" | "markdown" | "html" | "pdf" | "docx" | "pptx"`
  - `const DOCUMENT_EXTS: DocumentExt[]`
  - `const MAX_DOC_CHARS = 400_000`
  - `function documentExtFromName(filename: string): DocumentExt | null`
  - `async function extractDocumentText(buffer: Buffer, ext: DocumentExt): Promise<string>` — throws `Error` with a user-facing message when the document is empty or over the cap.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/document-extract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  documentExtFromName,
  extractDocumentText,
  MAX_DOC_CHARS,
} from "@/lib/context";

describe("documentExtFromName", () => {
  it("accepts the document formats", () => {
    expect(documentExtFromName("notes.txt")).toBe("txt");
    expect(documentExtFromName("Board Pack.DOCX")).toBe("docx");
    expect(documentExtFromName("deck.pptx")).toBe("pptx");
    expect(documentExtFromName("report.pdf")).toBe("pdf");
  });
  it("rejects everything else", () => {
    expect(documentExtFromName("talk.mp3")).toBeNull();
    expect(documentExtFromName("noextension")).toBeNull();
  });
});

describe("extractDocumentText", () => {
  it("reads plain text and strips markup from markdown", async () => {
    const md = Buffer.from("# Title\n\nSome **bold** text");
    expect(await extractDocumentText(md, "markdown")).toBe("Title\n\nSome bold text");
  });

  it("rejects a document with no extractable text", async () => {
    await expect(extractDocumentText(Buffer.from("   \n  "), "txt")).rejects.toThrow(
      /No text found/i,
    );
  });

  it("rejects a document over the size cap rather than truncating", async () => {
    const huge = Buffer.from("a".repeat(MAX_DOC_CHARS + 1));
    await expect(extractDocumentText(huge, "txt")).rejects.toThrow(/too long/i);
  });

  it("accepts a document exactly at the cap", async () => {
    const atCap = Buffer.from("a".repeat(MAX_DOC_CHARS));
    expect((await extractDocumentText(atCap, "txt")).length).toBe(MAX_DOC_CHARS);
  });
});
```

Add to `packages/core/test/transcribe.test.ts`:

```ts
describe("docBaseName over documents", () => {
  it("strips document extensions so the doc is not named report.pdf", () => {
    expect(docBaseName("report.pdf")).toBe("report");
    expect(docBaseName("Board Pack.docx")).toBe("Board Pack");
    expect(docBaseName("deck.pptx")).toBe("deck");
  });
  it("still strips media extensions", () => {
    expect(docBaseName("talk.mp3")).toBe("talk");
  });
  it("still leaves unknown extensions alone", () => {
    expect(docBaseName("talk.mp3.bak")).toBe("talk.mp3.bak");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm -w @event-editor/web run test -- document-extract`
Expected: FAIL, `documentExtFromName is not exported`.

- [ ] **Step 3: Implement extraction**

In `packages/web/lib/context.ts`, keep everything that exists (the context-file feature still uses it) and add:

```ts
export type DocumentExt = "txt" | "md" | "markdown" | "html" | "pdf" | "docx" | "pptx";

export const DOCUMENT_EXTS: DocumentExt[] = ["txt", "md", "markdown", "html", "pdf", "docx", "pptx"];

/** A half-read document produces a confident wrong summary, so anything over
 *  this is an error rather than a truncation. Roughly 100k tokens. */
export const MAX_DOC_CHARS = 400_000;

export function documentExtFromName(filename: string): DocumentExt | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return (DOCUMENT_EXTS as string[]).includes(ext) ? (ext as DocumentExt) : null;
}

export async function extractDocumentText(buffer: Buffer, ext: DocumentExt): Promise<string> {
  let text: string;
  if (ext === "txt") {
    text = buffer.toString("utf8").trim();
  } else if (ext === "md" || ext === "markdown" || ext === "html") {
    text = stripMarkup(buffer.toString("utf8"));
  } else {
    // pdf, docx, pptx: officeparser returns extracted plain text.
    text = stripMarkup(await parseOfficeAsync(buffer));
  }
  if (!text.trim()) {
    throw new Error(
      ext === "pdf"
        ? "No text found in this PDF, it may be scanned images."
        : "No text found in this document.",
    );
  }
  if (text.length > MAX_DOC_CHARS) {
    throw new Error(
      `This document is too long to summarise in one pass (${text.length.toLocaleString()} characters, limit ${MAX_DOC_CHARS.toLocaleString()}).`,
    );
  }
  return text;
}
```

- [ ] **Step 4: Implement the naming fix**

In `packages/core/src/transcribe.ts`, beside `MEDIA_EXTS`:

```ts
const DOC_EXTS = new Set(["txt", "md", "markdown", "html", "pdf", "docx", "pptx"]);
```

and in `docBaseName`, change the final line to:

```ts
  return MEDIA_EXTS.has(ext) || DOC_EXTS.has(ext) ? filename.slice(0, dot) : filename;
```

The check stays an allowlist, so `talk.mp3.bak` is still left alone.

- [ ] **Step 5: Run to verify they pass**

Run: `npm -w @event-editor/core run test -- transcribe && npm -w @event-editor/core run build && npm -w @event-editor/web run test -- document-extract`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/context.ts packages/core/src/transcribe.ts packages/web/test/document-extract.test.ts packages/core/test/transcribe.test.ts
git commit -m "feat: extract text from txt and docx documents with a size cap"
```

---

### Task 5: Document summary prompt

**Files:**
- Modify: `packages/core/src/transcribe.ts`
- Modify: `packages/web/lib/anthropic.ts:127-139`
- Test: `packages/core/test/transcribe.test.ts`

**Interfaces:**
- Produces:
  - `function buildDocumentSummaryPrompt(text: string): { role: "user"; content: string }[]`
  - `async function summarizeDocument(client: Anthropic, text: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/transcribe.test.ts`:

```ts
describe("buildDocumentSummaryPrompt", () => {
  it("frames the input as a document, not a recording", () => {
    const [msg] = buildDocumentSummaryPrompt("the document body");
    expect(msg.role).toBe("user");
    expect(msg.content).toContain("document");
    expect(msg.content).not.toContain("audio recording");
    expect(msg.content).toContain("the document body");
  });
  it("keeps the no-em-dashes instruction", () => {
    const [msg] = buildDocumentSummaryPrompt("x");
    expect(msg.content).toContain("Do not use em dashes");
  });
});
```

Add `buildDocumentSummaryPrompt` to the import list at the top of the file.

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @event-editor/core run test -- transcribe`
Expected: FAIL, `buildDocumentSummaryPrompt is not a function`.

- [ ] **Step 3: Implement the prompt**

In `packages/core/src/transcribe.ts`, beside `buildSummaryPrompt`:

```ts
export function buildDocumentSummaryPrompt(text: string): { role: "user"; content: string }[] {
  return [
    {
      role: "user",
      content:
        "You are summarizing a document. " +
        "Write a concise summary in clear prose: open with one sentence on what the document is about, " +
        "then the key points and any decisions or action items as short paragraphs. " +
        "Do not use em dashes. Return only the summary text, no preamble.\n\n" +
        "Document:\n" +
        text,
    },
  ];
}
```

- [ ] **Step 4: Add the client wrapper**

In `packages/web/lib/anthropic.ts`, beside `summarizeTranscript`, add a sibling that differs only in the prompt builder. Import `buildDocumentSummaryPrompt` alongside `buildSummaryPrompt`:

```ts
export async function summarizeDocument(client: Anthropic, text: string): Promise<string> {
  const res: any = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 2048,
    messages: buildDocumentSummaryPrompt(text),
  } as any);
  if (res.stop_reason === "refusal") {
    throw new Error("summary model refused to summarize this document");
  }
  const text_ = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  if (!text_.trim()) throw new Error("summary model returned empty output");
  return text_.trim();
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm -w @event-editor/core run test -- transcribe && npm -w @event-editor/core run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/transcribe.ts packages/web/lib/anthropic.ts packages/core/test/transcribe.test.ts
git commit -m "feat: add a document-framed summary prompt"
```

---

### Task 6: `runDocumentSummary` pipeline

**Files:**
- Modify: `packages/core/src/transcription.ts`
- Modify: `packages/web/lib/status.ts:18-27`
- Test: `packages/core/test/document-summary.test.ts` (create)

**Interfaces:**
- Consumes: `buildDocSections`, `buildDocHtml`, `DocSection` (Task 1); `docBaseName` (Task 4); schema columns (Task 3).
- Produces:
  - `interface DocumentSummaryDeps { summarize(text: string): Promise<string>; extractDetails(contextText: string, text: string): Promise<EventDetails>; writeDoc(sections: DocSection[], name: string, row: { sourceKind: string | null; sourceDocId: string | null }): Promise<{ id: string; url: string; tabId?: string }> }`
  - `async function runDocumentSummary(db, id: number, deps: DocumentSummaryDeps): Promise<void>`

Note `writeDoc` takes **sections**, not HTML, because the two output paths render differently. The web layer decides which renderer to use.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/document-summary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  openDb, runMigrations, transcriptions, createTranscription, runDocumentSummary,
} from "../src/index.js";

function freshDb() {
  const path = join(tmpdir(), `ee-docsum-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(path);
  runMigrations(db);
  return db;
}

const happyDeps = {
  summarize: async () => "the summary",
  extractDetails: async () => ({ eventName: "", eventDescription: "", speakers: [], sponsors: [] }),
  writeDoc: async () => ({ id: "doc1", url: "https://docs/doc1" }),
};

function seed(db: any, over: Record<string, unknown>) {
  const id = createTranscription(db, { originalFilename: "report.pdf" });
  db.update(transcriptions)
    .set({ sourceKind: "document", transcriptText: "the document body", ...over })
    .where(eq(transcriptions.id, id)).run();
  return id;
}

describe("runDocumentSummary", () => {
  it("summarizes, writes a doc, and marks done", async () => {
    const db = freshDb();
    const id = seed(db, {});
    await runDocumentSummary(db, id, happyDeps);
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("done");
    expect(row.summaryText).toBe("the summary");
    expect(row.docId).toBe("doc1");
    expect(row.docUrl).toBe("https://docs/doc1");
  });

  it("passes a Source document section for a dragged file", async () => {
    const db = freshDb();
    const id = seed(db, {});
    let seen: string[] = [];
    await runDocumentSummary(db, id, {
      ...happyDeps,
      writeDoc: async (sections) => { seen = sections.map((s) => s.heading); return { id: "d", url: "u" }; },
    });
    expect(seen).toEqual(["Summary", "Source document"]);
  });

  it("passes no source section for a gdoc, and stores the tab id", async () => {
    const db = freshDb();
    const id = seed(db, { sourceKind: "gdoc", sourceDocId: "srcdoc" });
    let seen: string[] = [];
    await runDocumentSummary(db, id, {
      ...happyDeps,
      writeDoc: async (sections) => { seen = sections.map((s) => s.heading); return { id: "srcdoc", url: "u", tabId: "t.9" }; },
    });
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(seen).toEqual(["Summary"]);
    expect(row.docTabId).toBe("t.9");
  });

  it("records the error message and stops on failure", async () => {
    const db = freshDb();
    const id = seed(db, {});
    await runDocumentSummary(db, id, {
      ...happyDeps,
      summarize: async () => { throw new Error("model exploded"); },
    });
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("error");
    expect(row.errorMessage).toBe("model exploded");
  });

  it("survives a details-extraction failure", async () => {
    const db = freshDb();
    const id = seed(db, {});
    await runDocumentSummary(db, id, {
      ...happyDeps,
      extractDetails: async () => { throw new Error("nope"); },
    });
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(row.status).toBe("done");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @event-editor/core run test -- document-summary`
Expected: FAIL, `runDocumentSummary is not exported`.

- [ ] **Step 3: Implement**

Append to `packages/core/src/transcription.ts`, and extend its import from `./transcribe.js` with `buildDocSections`, plus `type DocSection`:

```ts
export interface DocumentSummaryDeps {
  summarize(text: string): Promise<string>;
  extractDetails(contextText: string, text: string): Promise<EventDetails>;
  writeDoc(
    sections: DocSection[],
    name: string,
    row: { sourceKind: string | null; sourceDocId: string | null },
  ): Promise<{ id: string; url: string; tabId?: string }>;
}

// The document path joins runTranscription's pipeline at the summarize stage:
// the text is already extracted at ingest, so there is nothing to chunk.
export async function runDocumentSummary(
  db: BetterSQLite3Database<any>,
  id: number,
  deps: DocumentSummaryDeps,
): Promise<void> {
  try {
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    if (!row) throw new Error(`transcription ${id} not found`);
    const text = row.transcriptText ?? "";
    if (!text.trim()) throw new Error("no document text to summarize");

    touch(db, id, { status: "summarizing" });
    const summary = await deps.summarize(text);
    touch(db, id, { summaryText: summary, status: "creating_doc" });

    let details: EventDetails;
    try {
      details = await deps.extractDetails(row.contextText ?? "", text);
    } catch {
      details = { eventName: "", eventDescription: "", speakers: [], sponsors: [] };
    }
    touch(db, id, { eventDetails: JSON.stringify(details) });

    const sections = buildDocSections({
      sourceKind: (row.sourceKind as any) ?? "document",
      summary,
      linkedin: null,
      article: null,
      sourceText: text,
    });
    const doc = await deps.writeDoc(sections, docBaseName(row.originalFilename) + " summary", {
      sourceKind: row.sourceKind,
      sourceDocId: row.sourceDocId,
    });
    touch(db, id, {
      docId: doc.id,
      docUrl: doc.url,
      docTabId: doc.tabId ?? null,
      status: "done",
    });
  } catch (err) {
    touch(db, id, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  }
}
```

- [ ] **Step 4: Add the `reading` status label**

In `packages/web/lib/status.ts`, inside `transcriptionStatusView`, above the `transcribing` case:

```ts
    case "reading": return { tone: "active", label: "Reading the document" };
```

Without this the raw string `reading` leaks into the badge.

- [ ] **Step 5: Run to verify it passes**

Run: `npm -w @event-editor/core run test -- document-summary`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/transcription.ts packages/core/test/document-summary.test.ts packages/web/lib/status.ts
git commit -m "feat: add the document summary pipeline"
```

---

### Task 7: Docs API client, tab writing, and the new scope

**Files:**
- Modify: `packages/web/lib/google/oauth.ts:8-26`
- Modify: `packages/web/lib/google/docs.ts`
- Test: `packages/web/test/doc-tab.test.ts` (create)

**Interfaces:**
- Consumes: `buildTabRequests`, `DocSection` (Tasks 1, 2).
- Produces:
  - `const DOCS_SCOPE = "https://www.googleapis.com/auth/documents"`
  - `async function authedDocsClient(db): Promise<docs_v1.Docs | null>`
  - `async function writeDocTab(docs, docId: string, title: string, sections: DocSection[]): Promise<{ tabId: string }>`
  - `async function deleteDocTab(docs, docId: string, tabId: string): Promise<void>`
  - `function docTabUrl(docId: string, tabId: string): string`
  - `function friendlyDocsError(err: unknown): string`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/doc-tab.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { writeDocTab, deleteDocTab, docTabUrl, friendlyDocsError } from "@/lib/google/docs";
import type { DocSection } from "@event-editor/core/transcribe";

const sections: DocSection[] = [
  { heading: "Summary", body: { kind: "paras", text: "hello" } },
];

function fakeDocs(addReply: any = { addDocumentTab: { tabProperties: { tabId: "t.new" } } }) {
  const batchUpdate = vi.fn().mockResolvedValue({ data: { replies: [addReply] } });
  return { docs: { documents: { batchUpdate } } as any, batchUpdate };
}

describe("writeDocTab", () => {
  it("adds a tab, reads its id from the reply, then fills it", async () => {
    const { docs, batchUpdate } = fakeDocs();
    const res = await writeDocTab(docs, "doc1", "Summary", sections);

    expect(res.tabId).toBe("t.new");
    expect(batchUpdate).toHaveBeenCalledTimes(2);

    const first = batchUpdate.mock.calls[0][0];
    expect(first.requestBody.requests).toEqual([
      { addDocumentTab: { tabProperties: { title: "Summary" } } },
    ]);

    const second = batchUpdate.mock.calls[1][0];
    expect(second.documentId).toBe("doc1");
    expect(second.requestBody.requests[0].insertText.location.tabId).toBe("t.new");
  });

  it("throws when Docs returns no tab id rather than writing into the wrong tab", async () => {
    const { docs } = fakeDocs({ addDocumentTab: {} });
    await expect(writeDocTab(docs, "doc1", "Summary", sections)).rejects.toThrow(/tab id/i);
  });
});

describe("deleteDocTab", () => {
  it("swallows a 404 so a hand-deleted tab self-heals", async () => {
    const err: any = new Error("not found");
    err.code = 404;
    const docs = { documents: { batchUpdate: vi.fn().mockRejectedValue(err) } } as any;
    await expect(deleteDocTab(docs, "doc1", "t.gone")).resolves.toBeUndefined();
  });

  it("rethrows anything else", async () => {
    const err: any = new Error("boom");
    err.code = 500;
    const docs = { documents: { batchUpdate: vi.fn().mockRejectedValue(err) } } as any;
    await expect(deleteDocTab(docs, "doc1", "t.x")).rejects.toThrow("boom");
  });
});

describe("docTabUrl", () => {
  it("links straight to the tab", () => {
    expect(docTabUrl("doc1", "t.9")).toBe("https://docs.google.com/document/d/doc1/edit?tab=t.9");
  });
});

describe("friendlyDocsError", () => {
  it("names the scope problem so the user knows to reconnect", () => {
    const err: any = new Error("Request had insufficient authentication scopes.");
    err.code = 403;
    expect(friendlyDocsError(err)).toMatch(/Reconnect Google in Settings/i);
  });

  it("names the permission problem separately", () => {
    const err: any = new Error("The caller does not have permission");
    err.code = 403;
    expect(friendlyDocsError(err)).toMatch(/edit access/i);
  });

  it("passes other messages through", () => {
    expect(friendlyDocsError(new Error("network down"))).toBe("network down");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @event-editor/web run test -- doc-tab`
Expected: FAIL, `writeDocTab is not exported`.

- [ ] **Step 3: Add the scope and the Docs client**

In `packages/web/lib/google/oauth.ts`, add beside the other scope constants:

```ts
export const DOCS_SCOPE = "https://www.googleapis.com/auth/documents";
```

Add it to the `scope` array in `buildAuthUrl`:

```ts
    scope: [DRIVE_SCOPE, DRIVE_FILE_SCOPE, SHEETS_SCOPE, DOCS_SCOPE],
```

Add a Docs client mirroring `authedDriveClient` exactly, changing only the final line:

```ts
export async function authedDocsClient(
  db: ReturnType<typeof openDb>,
): Promise<docs_v1.Docs | null> {
  const stored = getToken(db, "google");
  if (!stored) return null;
  const client = makeOAuthClient();
  client.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken ?? undefined,
    expiry_date: stored.expiryMs ?? undefined,
  });
  client.on("tokens", (t) => {
    saveToken(db, "google", {
      accessToken: t.access_token ?? stored.accessToken,
      refreshToken: t.refresh_token ?? null,
      expiryMs: t.expiry_date ?? null,
      scope: t.scope ?? null,
    });
  });
  return google.docs({ version: "v1", auth: client });
}
```

Add `docs_v1` to the type imports: `import type { drive_v3, docs_v1 } from "googleapis";`.

- [ ] **Step 4: Implement the tab writer**

In `packages/web/lib/google/docs.ts`, append:

```ts
import type { docs_v1 } from "googleapis";
import { buildTabRequests, type DocSection } from "@event-editor/core/transcribe";

/** Write the sections into a brand new tab of an existing Doc. Two calls: the
 *  first adds the tab and returns its id in the reply, the second fills it. */
export async function writeDocTab(
  docs: docs_v1.Docs,
  docId: string,
  title: string,
  sections: DocSection[],
): Promise<{ tabId: string }> {
  const added = await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: [{ addDocumentTab: { tabProperties: { title } } }] },
  });
  const tabId = added.data.replies?.[0]?.addDocumentTab?.tabProperties?.tabId;
  if (!tabId) throw new Error("Docs did not return a tab id");

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: buildTabRequests(sections, tabId) as any },
  });
  return { tabId };
}

/** Best-effort delete. A 404 means the user deleted our tab by hand, which is
 *  fine: the caller adds a fresh one straight after. */
export async function deleteDocTab(
  docs: docs_v1.Docs,
  docId: string,
  tabId: string,
): Promise<void> {
  try {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: [{ deleteTab: { tabId } }] },
    });
  } catch (err: any) {
    if (err?.code === 404) return;
    throw err;
  }
}

export function docTabUrl(docId: string, tabId: string): string {
  return `https://docs.google.com/document/d/${docId}/edit?tab=${tabId}`;
}

/** Tokens minted before the documents scope existed 403 on the first tab
 *  write. That is a different fix from a view-only document, so say which. */
export function friendlyDocsError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.code;
  if (code === 403 && /insufficient.*scope/i.test(message)) {
    return "Reconnect Google in Settings to allow writing into documents.";
  }
  if (code === 403) {
    return "You don't have edit access to that document.";
  }
  return message;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm -w @event-editor/web run test -- doc-tab`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/google/oauth.ts packages/web/lib/google/docs.ts packages/web/test/doc-tab.test.ts
git commit -m "feat: write generated sections into a Google Doc tab"
```

---

### Task 8: Ingest route

**Files:**
- Create: `packages/web/app/api/transcribe/document/route.ts`
- Create: `packages/web/lib/document-runner.ts`
- Test: `packages/web/test/document-route.test.ts` (create)

**Interfaces:**
- Consumes: `documentExtFromName`, `extractDocumentText` (Task 4); `runDocumentSummary` (Task 6); `writeDocTab`, `deleteDocTab`, `docTabUrl`, `friendlyDocsError`, `authedDocsClient` (Task 7); `summarizeDocument` (Task 5); `buildDocHtml` (Task 1).
- Produces: `function startDocumentSummary(db, id: number): void` in `lib/document-runner.ts`, mirroring `startTranscription` in `lib/transcriber.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/document-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const startDocumentSummary = vi.fn();
vi.mock("@/lib/document-runner", () => ({ startDocumentSummary }));

const exportFn = vi.fn();
vi.mock("@/lib/google/oauth", () => ({
  authedDriveClient: async () => ({ files: { export: exportFn } }),
}));

vi.mock("@/lib/upload-guard", () => ({ guardUpload: async () => null }));

const { POST } = await import("@/app/api/transcribe/document/route");

beforeEach(() => { startDocumentSummary.mockClear(); exportFn.mockClear(); });

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/transcribe/document", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/transcribe/document", () => {
  it("rejects an unsupported file extension and names what it accepts", async () => {
    const form = new FormData();
    form.set("file", new File(["x"], "talk.mp3"));
    const res = await POST(new Request("http://localhost/api/transcribe/document", { method: "POST", body: form }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/docx/);
  });

  it("accepts a txt upload and starts the job", async () => {
    const form = new FormData();
    form.set("file", new File(["some body text"], "notes.txt"));
    const res = await POST(new Request("http://localhost/api/transcribe/document", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("id");
    expect(startDocumentSummary).toHaveBeenCalledOnce();
  });

  it("surfaces an empty document as a 400, not a started job", async () => {
    const form = new FormData();
    form.set("file", new File(["   "], "notes.txt"));
    const res = await POST(new Request("http://localhost/api/transcribe/document", { method: "POST", body: form }));
    expect(res.status).toBe(400);
    expect(startDocumentSummary).not.toHaveBeenCalled();
  });

  it("exports a picked Google Doc as plain text and starts the job", async () => {
    exportFn.mockResolvedValue({ data: "the doc body" });
    const res = await POST(jsonRequest({ fileId: "doc1", name: "Board Pack" }));
    expect(res.status).toBe(200);
    expect(exportFn).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "doc1", mimeType: "text/plain" }),
    );
    expect(startDocumentSummary).toHaveBeenCalledOnce();
  });

  it("requires either a file or a fileId", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @event-editor/web run test -- document-route`
Expected: FAIL, cannot resolve `@/app/api/transcribe/document/route`.

- [ ] **Step 3: Write the runner**

Create `packages/web/lib/document-runner.ts`:

```ts
import { runDocumentSummary } from "@event-editor/core/transcription";
import { buildDocHtml } from "@event-editor/core/transcribe";
import type { openDb } from "@event-editor/core/db";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import { visionClient, summarizeDocument, extractEventDetails } from "./anthropic";
import { authedDriveClient, authedDocsClient } from "./google/oauth";
import { createGoogleDoc, writeDocTab, deleteDocTab, docTabUrl, friendlyDocsError } from "./google/docs";
import { withBackoff } from "./backoff";

type Db = ReturnType<typeof openDb>;

function fail(db: Db, id: number, message: string) {
  db.update(transcriptions)
    .set({ status: "error", errorMessage: message, updatedAt: Date.now() })
    .where(eq(transcriptions.id, id))
    .run();
}

export function startDocumentSummary(db: Db, id: number): void {
  // Preflight synchronously, same reason as startTranscription: a missing-key
  // throw would land outside the try/catch and strand the row.
  if (!process.env.ANTHROPIC_API_KEY) return fail(db, id, "ANTHROPIC_API_KEY is not set");
  const client = visionClient();

  void (async () => {
    const drive = await authedDriveClient(db);
    if (!drive) { fail(db, id, "Google is not connected. Re-auth on /settings."); return; }

    await runDocumentSummary(db, id, {
      summarize: (text) => withBackoff(() => summarizeDocument(client, text)),
      extractDetails: (contextText, text) => withBackoff(() => extractEventDetails(client, contextText, text)),
      writeDoc: async (sections, name, row) => {
        // A gdoc source writes a tab inside the original. Anything else gets
        // its own new doc through the existing Drive HTML import.
        if (row.sourceKind === "gdoc" && row.sourceDocId) {
          const docs = await authedDocsClient(db);
          if (!docs) throw new Error("Google is not connected. Re-auth on /settings.");
          try {
            const { tabId } = await writeDocTab(docs, row.sourceDocId, "Summary", sections);
            return { id: row.sourceDocId, url: docTabUrl(row.sourceDocId, tabId), tabId };
          } catch (err) {
            throw new Error(friendlyDocsError(err));
          }
        }
        const doc = await createGoogleDoc(drive, buildDocHtml(sections), name);
        return { id: doc.id, url: doc.url };
      },
    });
  })();
}
```

- [ ] **Step 4: Write the route**

Create `packages/web/app/api/transcribe/document/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createTranscription } from "@event-editor/core/transcription";
import { transcriptions } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { documentExtFromName, extractDocumentText, DOCUMENT_EXTS } from "@/lib/context";
import { startDocumentSummary } from "@/lib/document-runner";
import { guardUpload } from "@/lib/upload-guard";

export const runtime = "nodejs";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "document";
}

export async function POST(request: Request) {
  // Lives under the middleware-exempt /api/transcribe prefix, so auth runs
  // here (see lib/upload-guard.ts).
  const blocked = await guardUpload(request);
  if (blocked) return blocked;

  const contentType = request.headers.get("content-type") ?? "";
  let name: string;
  let text: string;
  let sourceKind: "document" | "gdoc";
  let sourceDocId: string | null = null;

  try {
    if (contentType.includes("application/json")) {
      const { fileId, name: given } = (await request.json().catch(() => ({}))) as {
        fileId?: string; name?: string;
      };
      if (!fileId) {
        return NextResponse.json({ error: "Pick a Google Doc, or drop a file." }, { status: 400 });
      }
      const drive = await authedDriveClient(getDb());
      if (!drive) {
        return NextResponse.json({ error: "Google is not connected. Re-auth on /settings." }, { status: 400 });
      }
      const res = await drive.files.export({ fileId, mimeType: "text/plain" });
      text = String(res.data ?? "").trim();
      if (!text) return NextResponse.json({ error: "That document is empty." }, { status: 400 });
      name = safeName(given || "document");
      sourceKind = "gdoc";
      sourceDocId = fileId;
    } else {
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Pick a Google Doc, or drop a file." }, { status: 400 });
      }
      const ext = documentExtFromName(file.name);
      if (!ext) {
        return NextResponse.json(
          { error: `That file type isn't supported. Try one of: ${DOCUMENT_EXTS.join(", ")}.` },
          { status: 400 },
        );
      }
      text = await extractDocumentText(Buffer.from(await file.arrayBuffer()), ext);
      name = safeName(file.name);
      sourceKind = "document";
    }
  } catch (err) {
    // Extraction errors (empty, scanned, over the cap) are user-facing.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const db = getDb();
  const id = createTranscription(db, { originalFilename: name });
  db.update(transcriptions)
    .set({ sourceKind, sourceDocId, transcriptText: text, status: "reading", updatedAt: Date.now() })
    .where(eq(transcriptions.id, id))
    .run();

  startDocumentSummary(db, id);
  return NextResponse.json({ id });
}
```

- [ ] **Step 5: Keep the upload guard in sync**

`lib/upload-guard.ts` carries `UPLOAD_ROUTE_PREFIXES`, which must match the middleware matcher's negative lookahead. Confirm `/api/transcribe` already covers this new route. If the middleware lists routes individually rather than by prefix, add `/api/transcribe/document` to both, and note it in the commit message.

- [ ] **Step 6: Run to verify it passes**

Run: `npm -w @event-editor/web run test -- document-route`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/api/transcribe/document/route.ts packages/web/lib/document-runner.ts packages/web/test/document-route.test.ts
git commit -m "feat: ingest dragged documents and picked Google Docs"
```

---

### Task 9: Make `doc-sync` tab-aware

Closes the footgun: `updateGoogleDoc` is a whole-file HTML re-import, and aimed at a multi-tab document it replaces the user's original content.

**Files:**
- Modify: `packages/web/lib/doc-sync.ts`
- Test: `packages/web/test/doc-sync-tabs.test.ts` (create)

**Interfaces:**
- Consumes: `writeDocTab`, `deleteDocTab` (Task 7); `buildDocSections`, `buildDocHtml` (Task 1); schema columns (Task 3).
- Produces: `DocSyncRow` gains `sourceKind: string | null`, `sourceDocId: string | null`, `docTabId: string | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/doc-sync-tabs.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateGoogleDoc = vi.fn().mockResolvedValue(undefined);
const writeDocTab = vi.fn().mockResolvedValue({ tabId: "t.new" });
const deleteDocTab = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/google/docs", () => ({ updateGoogleDoc, writeDocTab, deleteDocTab, docTabUrl: () => "u", friendlyDocsError: (e: any) => String(e) }));
vi.mock("@/lib/google/oauth", () => ({
  authedDriveClient: async () => ({}),
  authedDocsClient: async () => ({}),
}));

const { syncTranscriptionDoc } = await import("@/lib/doc-sync");

const base = {
  id: 7, docId: "doc1", summaryText: "s", transcriptText: "t", transcriptSegments: null,
  summaryLinkedin: "post", summaryArticle: null,
  sourceKind: null as string | null, sourceDocId: null as string | null, docTabId: null as string | null,
};

beforeEach(() => { updateGoogleDoc.mockClear(); writeDocTab.mockClear(); deleteDocTab.mockClear(); });

describe("syncTranscriptionDoc", () => {
  it("re-imports HTML for an audio row, as before", async () => {
    expect(await syncTranscriptionDoc({} as any, { ...base })).toBe(true);
    expect(updateGoogleDoc).toHaveBeenCalledOnce();
    expect(writeDocTab).not.toHaveBeenCalled();
  });

  it("NEVER whole-file re-imports a gdoc row, because that destroys the original", async () => {
    await syncTranscriptionDoc({} as any, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: "t.old",
    });
    expect(updateGoogleDoc).not.toHaveBeenCalled();
  });

  it("replaces the tab: delete the old one, write a fresh one", async () => {
    const ok = await syncTranscriptionDoc({} as any, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: "t.old",
    });
    expect(ok).toBe(true);
    expect(deleteDocTab).toHaveBeenCalledWith(expect.anything(), "src", "t.old");
    expect(writeDocTab).toHaveBeenCalledOnce();
  });

  it("writes a fresh tab when we never had one", async () => {
    await syncTranscriptionDoc({} as any, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: null,
    });
    expect(deleteDocTab).not.toHaveBeenCalled();
    expect(writeDocTab).toHaveBeenCalledOnce();
  });

  it("sends no source section into a gdoc tab", async () => {
    await syncTranscriptionDoc({} as any, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: null,
    });
    const sections = writeDocTab.mock.calls[0][3];
    expect(sections.map((s: any) => s.heading)).toEqual(["Summary", "LinkedIn post"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm -w @event-editor/web run test -- doc-sync-tabs`
Expected: FAIL, the gdoc cases call `updateGoogleDoc`.

- [ ] **Step 3: Implement the dispatch**

Rewrite `syncTranscriptionDoc` in `packages/web/lib/doc-sync.ts`. Extend `DocSyncRow` with the three new fields, and replace the body:

```ts
export async function syncTranscriptionDoc(db: Db, row: DocSyncRow): Promise<boolean> {
  if (!row.summaryText) return false;
  try {
    const kind = row.sourceKind ?? "audio";
    const sections = buildDocSections({
      sourceKind: kind as any,
      summary: row.summaryText,
      linkedin: row.summaryLinkedin,
      article: row.summaryArticle,
      segments: segmentsOf(row),
      sourceText: row.transcriptText,
    });

    // A gdoc row's doc has tabs, and updateGoogleDoc is a whole-file HTML
    // re-import: pointed at a multi-tab doc it would replace the user's
    // original content. So that path is unreachable here by construction.
    if (kind === "gdoc") {
      if (!row.sourceDocId) return false;
      const docs = await authedDocsClient(db);
      if (!docs) return false;
      if (row.docTabId) await deleteDocTab(docs, row.sourceDocId, row.docTabId);
      await writeDocTab(docs, row.sourceDocId, "Summary", sections);
      return true;
    }

    if (!row.docId) return false;
    const drive = await authedDriveClient(db);
    if (!drive) return false;
    await updateGoogleDoc(drive, row.docId, buildDocHtml(sections));
    return true;
  } catch {
    return false;
  }
}
```

Update the imports to pull `authedDocsClient` from `./google/oauth` and `writeDocTab`, `deleteDocTab` from `./google/docs`.

- [ ] **Step 4: Persist the new tab id**

`writeDocTab` returns a new `tabId` each time, so the row's `docTabId` must be updated or the next sync deletes a tab that no longer exists. In the `gdoc` branch, after the write:

```ts
      const { tabId } = await writeDocTab(docs, row.sourceDocId, "Summary", sections);
      db.update(transcriptions)
        .set({ docTabId: tabId, updatedAt: Date.now() })
        .where(eq(transcriptions.id, (row as any).id))
        .run();
```

This needs `id` on `DocSyncRow`. Add `id: number` to the type and check every caller in `app/api/transcribe/[id]/summary/route.ts` passes it.

Add this test to `doc-sync-tabs.test.ts`, with the db double captured at the top of the file:

```ts
function fakeDb() {
  const set = vi.fn().mockReturnValue({ where: () => ({ run: () => {} }) });
  return { db: { update: () => ({ set }) } as any, set };
}

it("writes the new tab id back, or the next sync deletes a tab that is gone", async () => {
  const { db, set } = fakeDb();
  await syncTranscriptionDoc(db, {
    ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: "t.old",
  });
  expect(set).toHaveBeenCalledWith(expect.objectContaining({ docTabId: "t.new" }));
});
```

Then mutation-check it: comment out the write-back, confirm RED, restore, confirm GREEN. A stale `docTabId` is the exact bug that makes the second draft edit fail, so this assertion has to be load-bearing.

- [ ] **Step 5: Run to verify it passes**

Run: `npm -w @event-editor/web run test -- doc-sync`
Expected: PASS, all cases including the pre-existing doc-sync tests.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/doc-sync.ts packages/web/test/doc-sync-tabs.test.ts packages/web/app/api/transcribe/
git commit -m "fix: never whole-file re-import a doc that has tabs"
```

---

### Task 10: The `/transcribe` UI

**REQUIRED SKILL:** Invoke `anti-vibecode` before writing any markup in this task. Reuse `Segmented`, `FileDrop`, `StatusBadge`, `btn` and `field` classes. Do not introduce new button styles. Card titles must use `text-[1rem]`, never `text-base` (that token is a fixed 13px and is a known mobile bug in this codebase).

**Files:**
- Modify: `packages/web/app/transcribe/TranscribeClient.tsx`
- Modify: `packages/web/app/transcribe/PastTranscriptions.tsx`
- Modify: `packages/web/app/api/transcribe/route.ts` (GET, add `sourceKind` to the list payload)
- Create: `packages/web/components/DocPicker.tsx`

**Interfaces:**
- Consumes: `POST /api/transcribe/document` (Task 8); `transcriptionStatusView` with the `reading` case (Task 6).
- Produces: `<DocPicker onPick={(file: { id: string; name: string }) => void} />`.

- [ ] **Step 1: Add the source switcher**

In `TranscribeClient.tsx`, add `const [source, setSource] = useState<"audio" | "document">("audio")` and render a `Segmented` above the existing drop zone:

```tsx
<Segmented
  options={[{ value: "audio", label: "Audio or video" }, { value: "document", label: "Document" }]}
  value={source}
  onChange={(v) => setSource(v as "audio" | "document")}
/>
```

Show the existing `FileDrop` when `source === "audio"`, unchanged. When `source === "document"`, show a `FileDrop` with `accept=".txt,.md,.markdown,.html,.pdf,.docx,.pptx"` and `label="Drop a document here, or click to browse"`, plus the `DocPicker` button beneath it.

- [ ] **Step 2: Write the picker**

Create `packages/web/components/DocPicker.tsx` following `lib/google/pickerClient.ts` exactly as `FolderPicker.tsx` does, but with a documents view rather than folders:

```tsx
view: new google.picker.DocsView(google.picker.ViewId.DOCUMENTS)
  .setIncludeFolders(true)
  .setSelectFolderEnabled(false),
```

and `enableFeature(google.picker.Feature.SUPPORT_DRIVES)` so shared drives work, matching the FolderPicker fix from v0.0.21. On pick, call `onPick({ id, name })`.

Picking is what grants `drive.file` access to that document. A pasted URL would not, so there is deliberately no URL input.

- [ ] **Step 3: Wire the submits**

Document file upload posts multipart to `/api/transcribe/document`. Picked Doc posts JSON `{ fileId, name }` to the same route. Both get `{ id }` back and then reuse the existing polling path unchanged: set `id`, let `usePollWhileVisible` take over.

Errors from the route come back as `{ error }` with status 400. Surface them in the existing `uploadError` slot, do not invent a new error component.

- [ ] **Step 4: Tag history rows by source**

Add `sourceKind: r.sourceKind` to the GET payload in `app/api/transcribe/route.ts`. In `PastTranscriptions.tsx`, show a small source label per row (document rows read "Document", gdoc rows "Google Doc", everything else stays as it is today so old rows are unchanged).

- [ ] **Step 5: Verify in a browser**

Run `npm run dev`, open `/transcribe`.

Confirm: the switcher toggles the two drop zones; dropping a `.txt` starts a job and the badge reads "Reading the document" then "Summarizing with Claude"; dropping an `.mp3` in Document mode is rejected with the accepted-types message; the audio path still works exactly as before.

The Picker needs a real Google session, so it is covered by the manual walk below rather than here.

- [ ] **Step 6: Run the full suite and build**

Run: `npm -w @event-editor/core run test && npm -w @event-editor/core run build && npm -w @event-editor/web run test && npm -w @event-editor/web run build`
Expected: PASS, clean build.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/transcribe/ packages/web/components/DocPicker.tsx packages/web/app/api/transcribe/route.ts
git commit -m "feat: document source switcher and Google Doc picker on /transcribe"
```

---

## Manual walk (owed, cannot be mocked)

Scope grants and Drive permissions have no meaningful test double. After Task 10:

1. Reconnect Google in Settings. Confirm the consent screen now asks for document access.
2. Pick a real Google Doc through the picker. Confirm a tab titled "Summary" appears in that document, containing Summary and nothing else, and that the original tab is untouched.
3. Generate a LinkedIn draft. Confirm the tab is replaced, still titled "Summary", now containing the post, and the original tab is still untouched.
4. Delete the tab by hand, then generate an article. Confirm a fresh tab appears rather than an error.
5. Pick a Doc you only have view access to. Confirm the error reads "You don't have edit access to that document."
6. Drop a `.docx` and confirm a new Google Doc appears in My Drive named without the extension.
7. Drop a scanned PDF and confirm the "may be scanned images" message.

Added by the final whole-branch review, since these only appear once the tasks
combine:

8. Pick a Doc that **already has tabs**. Confirm the export captured its content,
   exactly one tab was added, and every pre-existing tab is untouched. This is
   the data-loss case the whole design guards against.
9. On a gdoc row, edit the LinkedIn draft and tab straight into the article draft
   so two saves fire together. Count the "Summary" tabs afterwards: there must be
   exactly one.
10. Force the scope 403 on a token minted before the `documents` scope, reconnect
    Google, then press "Try again". It must complete rather than dead-end.
11. Pick a Doc over 400,000 characters and confirm the cap message, not a raw
    model error.

Known limit, deliberately not addressed: the concurrency guard is per-process.
Two Node instances against one sqlite file could still race. The app is
single-process, so this is a note, not a gap.
