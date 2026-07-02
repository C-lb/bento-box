# Slide Slicer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Slide Slicer tool that converts a PPTX to PDF, splits it into named portions (by manual page ranges or AI speaker segmentation), optionally watermarks each page `CONFIDENTIAL`, and delivers per-portion downloads + zip + optional Google Drive save; plus a small unsaved-changes nudge on the transcriber's event-details panel.

**Architecture:** Pure logic lives in `@event-editor/core` (range planning, slide-XML parsing, prompt builders). IO lives in `packages/web/lib` (LibreOffice shell-out, pdf-lib slicing/watermarking, Drive upload). Thin Next.js route handlers wrap tested lib functions. Confidential decks are processed in an ephemeral per-run temp dir under `data/slice/<runId>/` and never written to the app db.

**Tech Stack:** Next.js (App Router, `runtime = "nodejs"`), TypeScript, Vitest, Drizzle (unused here — no persistence), `pdf-lib` (new), `jszip` (new), `archiver` (existing), `officeparser` (existing, not used — we parse slide XML directly), `@anthropic-ai/sdk` (existing), LibreOffice `soffice` (external binary).

## Global Constraints

- Route handlers that touch fs / spawn / Drive MUST declare `export const runtime = "nodejs";`.
- Web imports core via SUBPATH exports only (e.g. `@event-editor/core/slice-plan`), never deep `dist/` paths.
- Turbopack requires EXTENSIONLESS relative value imports inside `packages/web` (e.g. `import { x } from "./slice"`, not `./slice.ts`).
- Core test files import source with a `.js` extension (e.g. `../src/slice-plan.js`) — matches existing core tests.
- Every new core module MUST be registered in `packages/core/package.json` `exports`, and core MUST be rebuilt (`npm -w @event-editor/core run build`) before web can import it.
- UI copy contains NO em dashes. Sentence-case eyebrows. Follow the anti-vibecode house style already used by the other tools (shared `Nav`, `StatusBadge`, `card`, `btn`, `btn-accent`, `field`, `eyebrow`, `text-muted`, `text-success`, `text-danger` classes).
- Confidential slide content is NEVER written to the app db. Only temp files under `data/slice/<runId>/`, cleaned up by the caller.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Test commands:
  - core single file: `cd packages/core && npx vitest run test/<file>`
  - web single file: `cd packages/web && npx vitest run test/<file>`
  - full suite: `npm test` from repo root.

---

### Task 1: Transcription unsaved-changes nudge

**Files:**
- Modify: `packages/web/app/transcribe/EventDetailsPanel.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no exported API change; behavior only.

- [ ] **Step 1: Replace the panel with dirty-tracking + save nudge + navigation guard**

Rewrite `packages/web/app/transcribe/EventDetailsPanel.tsx` to this:

```tsx
"use client";
import { useState, useEffect, useMemo } from "react";
import { Plus, X, AlertTriangle } from "lucide-react";

interface Person { name: string; company: string }
export interface Details { eventName: string; eventDescription: string; speakers: Person[]; sponsors: Person[] }

function PeopleEditor({ label, rows, onChange }: { label: string; rows: Person[]; onChange: (r: Person[]) => void }) {
  return (
    <div className="mt-4">
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input className="field flex-1" placeholder="Name" value={r.name}
              onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className="field flex-1" placeholder="Company" value={r.company}
              onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, company: e.target.value } : x))} />
            <button type="button" className="btn" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" className="btn inline-flex items-center gap-2" onClick={() => onChange([...rows, { name: "", company: "" }])}>
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </div>
  );
}

export function EventDetailsPanel({ id, initial, onSaved }: { id: number; initial: Details; onSaved: () => void }) {
  const [d, setD] = useState<Details>(initial);
  const [baseline, setBaseline] = useState<Details>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Dirty when the current form differs from the last-saved snapshot.
  const dirty = useMemo(() => JSON.stringify(d) !== JSON.stringify(baseline), [d, baseline]);

  // Warn before leaving/reloading the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch(`/api/transcribe/${id}/details`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(d),
      });
      if (r.ok) { setBaseline(d); setSaved(true); onSaved(); setTimeout(() => setSaved(false), 1500); }
    } finally { setSaving(false); }
  }

  return (
    <div className="card mt-5">
      <p className="eyebrow">Event details</p>
      <p className="mt-2 text-sm text-muted">Correct anything below, then press Save details. Edits are not applied until you save. Saving updates the LinkedIn and Article versions.</p>
      <label className="mt-4 block text-sm font-medium">Event name
        <input className="field mt-1 w-full" value={d.eventName} onChange={(e) => setD({ ...d, eventName: e.target.value })} />
      </label>
      <label className="mt-4 block text-sm font-medium">Description
        <textarea className="field mt-1 w-full" rows={3} value={d.eventDescription} onChange={(e) => setD({ ...d, eventDescription: e.target.value })} />
      </label>
      <PeopleEditor label="Speakers" rows={d.speakers} onChange={(speakers) => setD({ ...d, speakers })} />
      <PeopleEditor label="Sponsors and partners" rows={d.sponsors} onChange={(sponsors) => setD({ ...d, sponsors })} />
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="btn btn-accent" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save details"}</button>
        {dirty && !saving && (
          <span className="inline-flex items-center gap-1.5 text-sm text-warning">
            <AlertTriangle className="w-4 h-4" aria-hidden /> Unsaved changes. Press Save details.
          </span>
        )}
        {saved && <span className="text-sm text-success">Saved.</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Confirm the `text-warning` class exists (fallback if not)**

Run: `cd packages/web && grep -RnE "text-warning|warning:" tailwind.config.ts app/globals.css`
Expected: a `warning` color token is defined. If NOT found, replace `text-warning` in the file above with `text-amber-600` (both light/dark safe) so the nudge still renders.

- [ ] **Step 3: Typecheck the web package**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no errors from `EventDetailsPanel.tsx`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/transcribe/EventDetailsPanel.tsx
git commit -m "feat(web): unsaved-changes nudge + navigation guard on transcription details panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Core slice plan (page-range parsing + grouping)

**Files:**
- Create: `packages/core/src/slice-plan.ts`
- Create: `packages/core/test/slice-plan.test.ts`
- Modify: `packages/core/package.json` (add `./slice-plan` export)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface GroupInput { label: string; ranges: string }`
  - `interface PlannedGroup { label: string; filename: string; pages: number[] }`
  - `interface SlicePlan { groups: PlannedGroup[]; warnings: string[] }`
  - `parseRanges(spec: string): number[]`
  - `safeFileName(label: string): string`
  - `summarizeRanges(pages: number[]): string`
  - `planSlices(inputs: GroupInput[], pageCount: number): SlicePlan`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/slice-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseRanges, safeFileName, summarizeRanges, planSlices } from "../src/slice-plan.js";

describe("parseRanges", () => {
  it("expands ranges and singles, sorted and deduped", () => {
    expect(parseRanges("1-3, 5, 2")).toEqual([1, 2, 3, 5]);
  });
  it("normalizes reversed ranges", () => {
    expect(parseRanges("5-3")).toEqual([3, 4, 5]);
  });
  it("ignores junk", () => {
    expect(parseRanges("a, , 2-x, 4")).toEqual([4]);
  });
});

describe("safeFileName", () => {
  it("strips unsafe chars and spaces", () => {
    expect(safeFileName("Q&A / Panel!")).toBe("QA-Panel");
  });
  it("falls back when empty", () => {
    expect(safeFileName("***")).toBe("part");
  });
});

describe("summarizeRanges", () => {
  it("collapses consecutive runs", () => {
    expect(summarizeRanges([1, 2, 3, 5, 7, 8])).toBe("1-3, 5, 7-8");
  });
});

describe("planSlices", () => {
  it("plans groups, clamps pages, and dedupes filenames", () => {
    const plan = planSlices(
      [
        { label: "Intro", ranges: "1-3" },
        { label: "Intro", ranges: "4" },
      ],
      5,
    );
    expect(plan.groups.map((g) => ({ f: g.filename, p: g.pages }))).toEqual([
      { f: "Intro.pdf", p: [1, 2, 3] },
      { f: "Intro-2.pdf", p: [4] },
    ]);
    expect(plan.warnings).toContain("Pages not in any group: 5.");
  });

  it("drops out-of-range pages with a warning and skips empty groups", () => {
    const plan = planSlices([{ label: "A", ranges: "9-12" }], 5);
    expect(plan.groups).toEqual([]);
    expect(plan.warnings.some((w) => w.includes("no valid pages"))).toBe(true);
  });

  it("warns on overlap between groups", () => {
    const plan = planSlices(
      [
        { label: "A", ranges: "1-3" },
        { label: "B", ranges: "3-4" },
      ],
      4,
    );
    expect(plan.warnings.some((w) => w.includes("Page 3 is in both"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/slice-plan.test.ts`
Expected: FAIL — cannot find module `../src/slice-plan.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/slice-plan.ts`:

```ts
export interface GroupInput { label: string; ranges: string }
export interface PlannedGroup { label: string; filename: string; pages: number[] }
export interface SlicePlan { groups: PlannedGroup[]; warnings: string[] }

/** Parse "1-3, 5" into a sorted, deduped list of 1-based page numbers. */
export function parseRanges(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(t)) {
      out.add(parseInt(t, 10));
    }
  }
  return [...out].sort((x, y) => x - y);
}

/** Turn a human label into a filesystem-safe base name (no extension). */
export function safeFileName(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || "part";
}

/** Collapse [1,2,3,5] into "1-3, 5" for readable warnings. */
export function summarizeRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) { prev = cur; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return parts.join(", ");
}

/** Build the ordered export plan from user group inputs and the master page count. */
export function planSlices(inputs: GroupInput[], pageCount: number): SlicePlan {
  const warnings: string[] = [];
  const groups: PlannedGroup[] = [];
  const usedNames = new Set<string>();
  const seenPages = new Map<number, string>();
  const covered = new Set<number>();

  inputs.forEach((g, i) => {
    const label = g.label.trim() || `Part ${i + 1}`;
    const raw = parseRanges(g.ranges);
    const pages = raw.filter((p) => p >= 1 && p <= pageCount);
    if (raw.some((p) => p < 1 || p > pageCount)) {
      warnings.push(`"${label}": some pages fall outside 1-${pageCount} and were dropped.`);
    }
    if (pages.length === 0) {
      warnings.push(`"${label}" has no valid pages and was skipped.`);
      return;
    }
    for (const p of pages) {
      if (seenPages.has(p)) warnings.push(`Page ${p} is in both "${seenPages.get(p)}" and "${label}".`);
      else seenPages.set(p, label);
      covered.add(p);
    }
    let base = safeFileName(label);
    let name = base;
    let n = 2;
    while (usedNames.has(name)) name = `${base}-${n++}`;
    usedNames.add(name);
    groups.push({ label, filename: `${name}.pdf`, pages });
  });

  const missing: number[] = [];
  for (let p = 1; p <= pageCount; p++) if (!covered.has(p)) missing.push(p);
  if (missing.length) warnings.push(`Pages not in any group: ${summarizeRanges(missing)}.`);

  return { groups, warnings };
}
```

- [ ] **Step 4: Register the export**

In `packages/core/package.json`, add to the `exports` object (alongside the others):

```json
"./slice-plan": "./dist/slice-plan.js",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/slice-plan.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/slice-plan.ts packages/core/test/slice-plan.test.ts packages/core/package.json
git commit -m "feat(core): page-range slice planner with clamp/overlap/gap warnings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Core PPTX slide parsing + speaker prompt

**Files:**
- Create: `packages/core/src/pptx.ts`
- Create: `packages/core/test/pptx.test.ts`
- Modify: `packages/core/package.json` (add `./pptx` export)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface SlideText { index: number; text: string; notes: string }`
  - `interface SpeakerGroup { speaker: string; startSlide: number; endSlide: number }`
  - `slideTextFromXml(xml: string): string`
  - `slideNumberFromPath(path: string): number | null`
  - `orderSlidePaths(paths: string[]): string[]`
  - `buildSpeakerSegmentPrompt(slides: SlideText[]): string`
  - `normalizeSpeakerGroups(groups: SpeakerGroup[], slideCount: number): SpeakerGroup[]`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/pptx.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  slideTextFromXml,
  slideNumberFromPath,
  orderSlidePaths,
  buildSpeakerSegmentPrompt,
  normalizeSpeakerGroups,
} from "../src/pptx.js";

describe("slideTextFromXml", () => {
  it("joins a:t runs and decodes entities", () => {
    const xml = `<p:sld><a:t>Welcome &amp; </a:t><a:t>Keynote</a:t></p:sld>`;
    expect(slideTextFromXml(xml)).toBe("Welcome & Keynote");
  });
  it("returns empty string when there is no text", () => {
    expect(slideTextFromXml("<p:sld/>")).toBe("");
  });
});

describe("slideNumberFromPath / orderSlidePaths", () => {
  it("extracts the slide index", () => {
    expect(slideNumberFromPath("ppt/slides/slide12.xml")).toBe(12);
    expect(slideNumberFromPath("ppt/slides/_rels/slide1.xml.rels")).toBe(null);
  });
  it("orders numerically, not lexically", () => {
    expect(orderSlidePaths(["ppt/slides/slide10.xml", "ppt/slides/slide2.xml", "ppt/slides/slide1.xml"]))
      .toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide10.xml"]);
  });
});

describe("buildSpeakerSegmentPrompt", () => {
  it("includes slide markers and both text and notes", () => {
    const p = buildSpeakerSegmentPrompt([
      { index: 1, text: "Intro by Ada", notes: "Ada speaking" },
      { index: 2, text: "Deep dive", notes: "" },
    ]);
    expect(p).toContain("Slide 1");
    expect(p).toContain("Intro by Ada");
    expect(p).toContain("Ada speaking");
    expect(p).toContain("Slide 2");
  });
});

describe("normalizeSpeakerGroups", () => {
  it("clamps, orders, swaps reversed bounds, and names blanks", () => {
    const out = normalizeSpeakerGroups(
      [
        { speaker: "", startSlide: 8, endSlide: 4 },
        { speaker: "Ada", startSlide: 0, endSlide: 2 },
      ],
      5,
    );
    expect(out).toEqual([
      { speaker: "Ada", startSlide: 1, endSlide: 2 },
      { speaker: "Speaker 2", startSlide: 4, endSlide: 5 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/pptx.test.ts`
Expected: FAIL — cannot find module `../src/pptx.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/pptx.ts`:

```ts
export interface SlideText { index: number; text: string; notes: string }
export interface SpeakerGroup { speaker: string; startSlide: number; endSlide: number }

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Pull all <a:t> text runs out of a slide/notes XML string. */
export function slideTextFromXml(xml: string): string {
  const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
  return runs.join(" ").replace(/\s+/g, " ").trim();
}

/** ppt/slides/slide12.xml -> 12. Non-slide files (rels etc.) -> null. */
export function slideNumberFromPath(path: string): number | null {
  const m = path.match(/(?:^|\/)slide(\d+)\.xml$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Order slide XML paths by their numeric slide index. */
export function orderSlidePaths(paths: string[]): string[] {
  return paths
    .filter((p) => slideNumberFromPath(p) !== null)
    .sort((a, b) => (slideNumberFromPath(a)! - slideNumberFromPath(b)!));
}

/** Prompt asking Claude to group contiguous slides by speaker. */
export function buildSpeakerSegmentPrompt(slides: SlideText[]): string {
  const body = slides
    .map((s) => {
      const notes = s.notes ? `\n  Notes: ${s.notes}` : "";
      return `Slide ${s.index}: ${s.text || "(no visible text)"}${notes}`;
    })
    .join("\n");
  return [
    "You are segmenting a slide deck into each speaker's contiguous portion.",
    "Read the slide text and speaker notes below. Group consecutive slides that belong to the same speaker into one portion.",
    "Rules:",
    "- Portions must be contiguous and non-overlapping, covering slides 1 to " + slides.length + " in order.",
    "- Use the speaker's name when it is clear; otherwise use a short descriptive label (for example \"Opening\", \"Panel\").",
    "- Return startSlide and endSlide as 1-based slide numbers.",
    "",
    body,
  ].join("\n");
}

/** Clamp AI-proposed groups to the slide range, fix reversed bounds, order, and name blanks. */
export function normalizeSpeakerGroups(groups: SpeakerGroup[], slideCount: number): SpeakerGroup[] {
  const clamp = (n: number) => Math.max(1, Math.min(Math.round(n), slideCount));
  const out = groups.map((g) => {
    let s = clamp(g.startSlide);
    let e = clamp(g.endSlide);
    if (s > e) [s, e] = [e, s];
    return { speaker: g.speaker.trim(), startSlide: s, endSlide: e };
  });
  out.sort((a, b) => a.startSlide - b.startSlide);
  return out.map((g, i) => ({ ...g, speaker: g.speaker || `Speaker ${i + 1}` }));
}
```

- [ ] **Step 4: Register the export**

In `packages/core/package.json` `exports`, add:

```json
"./pptx": "./dist/pptx.js",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/pptx.test.ts`
Expected: PASS.

- [ ] **Step 6: Build core so web can import the new subpaths**

Run: `npm -w @event-editor/core run build`
Expected: exits 0; `packages/core/dist/pptx.js` and `dist/slice-plan.js` exist.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pptx.ts packages/core/test/pptx.test.ts packages/core/package.json
git commit -m "feat(core): slide-XML text extraction + speaker segmentation prompt/normalizer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: PDF slicing + watermark (pdf-lib)

**Files:**
- Create: `packages/web/lib/pdf-slice.ts`
- Create: `packages/web/test/pdf-slice.test.ts`
- Modify: `packages/web/package.json` (add `pdf-lib` dependency)

**Interfaces:**
- Consumes: `PlannedGroup` from `@event-editor/core/slice-plan`.
- Produces:
  - `pdfPageCount(bytes: Uint8Array): Promise<number>`
  - `extractPages(masterBytes: Uint8Array, pages: number[]): Promise<Uint8Array>` (pages are 1-based)
  - `watermarkPdf(bytes: Uint8Array, text: string): Promise<Uint8Array>`
  - `interface OutputFile { label: string; filename: string; bytes: Uint8Array }`
  - `buildOutputs(masterBytes: Uint8Array, groups: PlannedGroup[], opts: { confidential: boolean; watermarkText: string }): Promise<OutputFile[]>`

- [ ] **Step 1: Add the dependency**

Run: `cd packages/web && npm install pdf-lib@^1.17.1`
Expected: `pdf-lib` added to `dependencies`.

- [ ] **Step 2: Write the failing test**

Create `packages/web/test/pdf-slice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfPageCount, extractPages, watermarkPdf, buildOutputs } from "../lib/pdf-slice";

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([300, 200]);
  return doc.save();
}

describe("pdf-slice", () => {
  it("reports page count", async () => {
    expect(await pdfPageCount(await makePdf(4))).toBe(4);
  });

  it("extracts the requested 1-based pages in order", async () => {
    const out = await extractPages(await makePdf(5), [2, 4]);
    expect(await pdfPageCount(out)).toBe(2);
  });

  it("keeps page count when watermarking", async () => {
    const out = await watermarkPdf(await makePdf(3), "CONFIDENTIAL");
    expect(await pdfPageCount(out)).toBe(3);
  });

  it("builds one output per group and watermarks only when confidential", async () => {
    const master = await makePdf(6);
    const groups = [
      { label: "Intro", filename: "Intro.pdf", pages: [1, 2] },
      { label: "Q&A", filename: "QA.pdf", pages: [5, 6] },
    ];
    const plain = await buildOutputs(master, groups, { confidential: false, watermarkText: "CONFIDENTIAL" });
    expect(plain.map((f) => f.filename)).toEqual(["Intro.pdf", "QA.pdf"]);
    expect(await pdfPageCount(plain[0].bytes)).toBe(2);

    const marked = await buildOutputs(master, groups, { confidential: true, watermarkText: "SECRET" });
    // Watermarked output is a valid 2-page PDF and is larger than the plain one (extra text object).
    expect(await pdfPageCount(marked[0].bytes)).toBe(2);
    expect(marked[0].bytes.byteLength).toBeGreaterThan(plain[0].bytes.byteLength);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/pdf-slice.test.ts`
Expected: FAIL — cannot find module `../lib/pdf-slice`.

- [ ] **Step 4: Write the implementation**

Create `packages/web/lib/pdf-slice.ts`:

```ts
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PlannedGroup } from "@event-editor/core/slice-plan";

export interface OutputFile { label: string; filename: string; bytes: Uint8Array }

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

/** Copy the given 1-based pages (in the given order) into a new PDF. */
export async function extractPages(masterBytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(masterBytes);
  const total = src.getPageCount();
  const idxs = pages.map((p) => p - 1).filter((i) => i >= 0 && i < total);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, idxs);
  copied.forEach((pg) => out.addPage(pg));
  return out.save();
}

/** Stamp a large diagonal, semi-transparent grey watermark on every page. */
export async function watermarkPdf(bytes: Uint8Array, text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const label = text.trim() || "CONFIDENTIAL";
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) * 0.16;
    const textWidth = font.widthOfTextAtSize(label, size);
    const angle = Math.PI / 4; // 45 degrees
    // Center the rotated string roughly on the page middle.
    const x = width / 2 - (Math.cos(angle) * textWidth) / 2;
    const y = height / 2 - (Math.sin(angle) * textWidth) / 2;
    page.drawText(label, {
      x,
      y,
      size,
      font,
      color: rgb(0.6, 0.6, 0.6),
      rotate: degrees(45),
      opacity: 0.25,
    });
  }
  return doc.save();
}

/** Build one PDF per planned group, watermarking when confidential. */
export async function buildOutputs(
  masterBytes: Uint8Array,
  groups: PlannedGroup[],
  opts: { confidential: boolean; watermarkText: string },
): Promise<OutputFile[]> {
  const out: OutputFile[] = [];
  for (const g of groups) {
    let bytes = await extractPages(masterBytes, g.pages);
    if (opts.confidential) bytes = await watermarkPdf(bytes, opts.watermarkText);
    out.push({ label: g.label, filename: g.filename, bytes });
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/pdf-slice.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/pdf-slice.ts packages/web/test/pdf-slice.test.ts packages/web/package.json packages/web/package-lock.json ../../package-lock.json
git commit -m "feat(web): pdf-lib page extraction + diagonal confidential watermark

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(If the root `package-lock.json` did not change, drop it from the `git add`.)

---

### Task 5: LibreOffice conversion + slide reading

**Files:**
- Create: `packages/web/lib/pptx-convert.ts`
- Create: `packages/web/test/pptx-convert.test.ts`
- Modify: `packages/web/package.json` (add `jszip` dependency)

**Interfaces:**
- Consumes: `slideTextFromXml`, `slideNumberFromPath`, `orderSlidePaths`, `SlideText` from `@event-editor/core/pptx`.
- Produces:
  - `sofficeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[]`
  - `resolveSofficePath(candidates: string[], exists: (p: string) => boolean): string | null`
  - `findSoffice(): string | null`
  - `convertToPdf(pptxPath: string, outDir: string): Promise<string>` (returns master PDF path)
  - `readSlides(pptxPath: string): Promise<SlideText[]>`

- [ ] **Step 1: Add the dependency**

Run: `cd packages/web && npm install jszip@^3.10.1`
Expected: `jszip` added to `dependencies`.

- [ ] **Step 2: Write the failing test**

Create `packages/web/test/pptx-convert.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sofficeCandidates, resolveSofficePath, readSlides } from "../lib/pptx-convert";
import JSZip from "jszip";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("sofficeCandidates", () => {
  it("includes the macOS app bundle path on darwin", () => {
    const c = sofficeCandidates("darwin", {});
    expect(c).toContain("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  });
  it("honors an explicit override via env", () => {
    const c = sofficeCandidates("linux", { EE_SOFFICE_PATH: "/opt/soffice" });
    expect(c[0]).toBe("/opt/soffice");
  });
});

describe("resolveSofficePath", () => {
  it("returns the first existing candidate", () => {
    expect(resolveSofficePath(["/a", "/b", "/c"], (p) => p === "/b")).toBe("/b");
  });
  it("returns null when none exist", () => {
    expect(resolveSofficePath(["/a"], () => false)).toBe(null);
  });
});

describe("readSlides", () => {
  it("reads per-slide text and notes from a pptx zip in slide order", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", `<p:sld><a:t>First</a:t></p:sld>`);
    zip.file("ppt/slides/slide2.xml", `<p:sld><a:t>Second</a:t></p:sld>`);
    zip.file("ppt/notesSlides/notesSlide2.xml", `<p:notes><a:t>Note two</a:t></p:notes>`);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const dir = await mkdtemp(join(tmpdir(), "pptx-"));
    const path = join(dir, "deck.pptx");
    await writeFile(path, buf);

    const slides = await readSlides(path);
    expect(slides).toEqual([
      { index: 1, text: "First", notes: "" },
      { index: 2, text: "Second", notes: "Note two" },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/pptx-convert.test.ts`
Expected: FAIL — cannot find module `../lib/pptx-convert`.

- [ ] **Step 4: Write the implementation**

Create `packages/web/lib/pptx-convert.ts`:

```ts
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import JSZip from "jszip";
import { slideTextFromXml, slideNumberFromPath, orderSlidePaths, type SlideText } from "@event-editor/core/pptx";

/** Likely soffice locations for the current platform, with an env override first. */
export function sofficeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const list: string[] = [];
  if (env.EE_SOFFICE_PATH) list.push(env.EE_SOFFICE_PATH);
  if (platform === "darwin") {
    list.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  } else if (platform === "win32") {
    list.push(
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    );
  } else {
    list.push("/usr/bin/soffice", "/usr/local/bin/soffice", "/snap/bin/libreoffice");
  }
  return list;
}

export function resolveSofficePath(candidates: string[], exists: (p: string) => boolean): string | null {
  return candidates.find((p) => exists(p)) ?? null;
}

export function findSoffice(): string | null {
  return resolveSofficePath(sofficeCandidates(process.platform, process.env), existsSync);
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
      else reject(new Error(`soffice exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Convert a .pptx to PDF via LibreOffice headless. Returns the output PDF path. */
export async function convertToPdf(pptxPath: string, outDir: string): Promise<string> {
  const soffice = findSoffice();
  if (!soffice) throw new Error("LibreOffice (soffice) not found. Install it to slice slides.");
  await run(soffice, ["--headless", "--convert-to", "pdf", "--outdir", outDir, pptxPath]);
  const pdfName = basename(pptxPath).replace(/\.pptx$/i, ".pdf");
  const pdfPath = join(outDir, pdfName);
  if (!existsSync(pdfPath)) throw new Error("LibreOffice did not produce a PDF.");
  return pdfPath;
}

/** Extract per-slide text and speaker notes from a .pptx, in slide order. */
export async function readSlides(pptxPath: string): Promise<SlideText[]> {
  const buf = await readFile(pptxPath);
  const zip = await JSZip.loadAsync(buf);
  const slidePaths = orderSlidePaths(
    Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)),
  );
  const out: SlideText[] = [];
  for (const p of slidePaths) {
    const idx = slideNumberFromPath(p)!;
    const slideXml = await zip.files[p].async("string");
    const notesPath = `ppt/notesSlides/notesSlide${idx}.xml`;
    const notesXml = zip.files[notesPath] ? await zip.files[notesPath].async("string") : "";
    out.push({ index: idx, text: slideTextFromXml(slideXml), notes: notesXml ? slideTextFromXml(notesXml) : "" });
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/pptx-convert.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/pptx-convert.ts packages/web/test/pptx-convert.test.ts packages/web/package.json packages/web/package-lock.json
git commit -m "feat(web): LibreOffice pptx->pdf conversion + per-slide text/notes reader

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(Add the root `package-lock.json` too if it changed.)

---

### Task 6: Drive presentation listing + PDF upload

**Files:**
- Modify: `packages/web/lib/google/drive.ts`
- Create: `packages/web/test/drive-slice.test.ts`

**Interfaces:**
- Consumes: existing `makeDriveClient`.
- Produces (added to `DriveClient`):
  - `interface DrivePresentation { id: string; name: string }`
  - `listPresentations(folderId: string): Promise<DrivePresentation[]>`
  - `uploadPdf(name: string, bytes: Uint8Array, folderId: string): Promise<{ id: string; url: string }>`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/drive-slice.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { makeDriveClient } from "../lib/google/drive";

function fakeDrive(overrides: any = {}) {
  return {
    files: {
      list: vi.fn(async () => ({ data: { files: [{ id: "p1", name: "Deck.pptx" }], nextPageToken: undefined } })),
      create: vi.fn(async () => ({ data: { id: "up1", webViewLink: "https://drive/up1" } })),
      ...overrides,
    },
  } as any;
}

describe("drive slice helpers", () => {
  it("lists presentations in a folder", async () => {
    const drive = fakeDrive();
    const client = makeDriveClient(drive);
    const res = await client.listPresentations("folderX");
    expect(res).toEqual([{ id: "p1", name: "Deck.pptx" }]);
    const q = drive.files.list.mock.calls[0][0].q as string;
    expect(q).toContain("'folderX' in parents");
    expect(q).toContain("presentationml.presentation");
  });

  it("uploads a pdf and returns id + url", async () => {
    const drive = fakeDrive();
    const client = makeDriveClient(drive);
    const res = await client.uploadPdf("Intro.pdf", new Uint8Array([1, 2, 3]), "folderX");
    expect(res).toEqual({ id: "up1", url: "https://drive/up1" });
    const arg = drive.files.create.mock.calls[0][0];
    expect(arg.requestBody.name).toBe("Intro.pdf");
    expect(arg.requestBody.parents).toEqual(["folderX"]);
    expect(arg.media.mimeType).toBe("application/pdf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/drive-slice.test.ts`
Expected: FAIL — `listPresentations` / `uploadPdf` not a function.

- [ ] **Step 3: Extend the Drive client**

In `packages/web/lib/google/drive.ts`:

a) At the top, add the stream import:

```ts
import { Readable } from "node:stream";
```

b) Add the interface near `DriveFolder`:

```ts
export interface DrivePresentation { id: string; name: string }
```

c) Add these to the `DriveClient` interface:

```ts
  listPresentations(folderId: string): Promise<DrivePresentation[]>;
  uploadPdf(name: string, bytes: Uint8Array, folderId: string): Promise<{ id: string; url: string }>;
```

d) Add these two methods inside the object returned by `makeDriveClient` (after `thumbnailFor`):

```ts
    async listPresentations(folderId: string) {
      const out: DrivePresentation[] = [];
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation' and trashed=false`,
          fields: "nextPageToken, files(id,name)",
          pageSize: 100,
          pageToken,
        });
        for (const f of res.data.files ?? []) {
          if (f.id) out.push({ id: f.id, name: f.name ?? "(untitled)" });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    },
    async uploadPdf(name: string, bytes: Uint8Array, folderId: string) {
      const res = await drive.files.create({
        requestBody: { name, parents: folderId ? [folderId] : undefined },
        media: { mimeType: "application/pdf", body: Readable.from(Buffer.from(bytes)) },
        fields: "id, webViewLink",
      });
      const id = res.data.id;
      if (!id) throw new Error("Drive did not return a file id");
      return { id, url: res.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view` };
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/drive-slice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/google/drive.ts packages/web/test/drive-slice.test.ts
git commit -m "feat(web): Drive listPresentations + uploadPdf for slide slicer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Speaker segmentation client + status view

**Files:**
- Modify: `packages/web/lib/anthropic.ts`
- Modify: `packages/web/lib/status.ts`
- Create: `packages/web/test/segment-speakers.test.ts`
- Create: `packages/web/test/slice-status.test.ts`

**Interfaces:**
- Consumes: `buildSpeakerSegmentPrompt`, `normalizeSpeakerGroups`, `SlideText`, `SpeakerGroup` from `@event-editor/core/pptx`.
- Produces:
  - `segmentSpeakers(client: Anthropic, slides: SlideText[]): Promise<SpeakerGroup[]>`
  - `sliceStatusView(status: string): StatusView`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/segment-speakers.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { segmentSpeakers } from "../lib/anthropic";

describe("segmentSpeakers", () => {
  it("sends the prompt and normalizes the returned groups", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ groups: [{ speaker: "Ada", startSlide: 1, endSlide: 9 }] }) }],
    }));
    const client = { messages: { create } } as any;

    const groups = await segmentSpeakers(client, [
      { index: 1, text: "Intro", notes: "" },
      { index: 2, text: "End", notes: "" },
    ]);

    expect(groups).toEqual([{ speaker: "Ada", startSlide: 1, endSlide: 2 }]); // clamped to 2 slides
    const arg = create.mock.calls[0][0];
    expect(arg.output_config.format.type).toBe("json_schema");
    const promptText = arg.messages[0].content.find((b: any) => b.type === "text").text;
    expect(promptText).toContain("Slide 1");
  });

  it("throws on refusal", async () => {
    const client = { messages: { create: vi.fn(async () => ({ stop_reason: "refusal", content: [] })) } } as any;
    await expect(segmentSpeakers(client, [{ index: 1, text: "x", notes: "" }])).rejects.toThrow();
  });
});
```

Create `packages/web/test/slice-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sliceStatusView } from "../lib/status";

describe("sliceStatusView", () => {
  it("maps known statuses", () => {
    expect(sliceStatusView("converting").tone).toBe("active");
    expect(sliceStatusView("done").tone).toBe("success");
    expect(sliceStatusView("error").tone).toBe("error");
  });
  it("falls back to idle with the raw label", () => {
    expect(sliceStatusView("weird")).toEqual({ tone: "idle", label: "weird" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/web && npx vitest run test/segment-speakers.test.ts test/slice-status.test.ts`
Expected: FAIL — `segmentSpeakers` / `sliceStatusView` not exported.

- [ ] **Step 3: Add `sliceStatusView` to status.ts**

Append to `packages/web/lib/status.ts`:

```ts
export function sliceStatusView(status: string): StatusView {
  switch (status) {
    case "converting": return { tone: "active", label: "Converting with LibreOffice" };
    case "reading": return { tone: "active", label: "Reading slides" };
    case "segmenting": return { tone: "active", label: "Finding speaker portions" };
    case "exporting": return { tone: "active", label: "Building PDFs" };
    case "saving": return { tone: "active", label: "Saving to Drive" };
    case "done": return { tone: "success", label: "Done" };
    case "error": return { tone: "error", label: "Slicing failed" };
    default: return { tone: "idle", label: status };
  }
}
```

- [ ] **Step 4: Add `segmentSpeakers` to anthropic.ts**

a) Extend the existing core import at the top of `packages/web/lib/anthropic.ts` to also pull the pptx helpers. Add this import line near the other `@event-editor/core` imports:

```ts
import { buildSpeakerSegmentPrompt, normalizeSpeakerGroups, type SlideText, type SpeakerGroup } from "@event-editor/core/pptx";
```

b) Add the schema constant near the other `*_SCHEMA` constants:

```ts
const SEGMENT_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: { speaker: { type: "string" }, startSlide: { type: "integer" }, endSlide: { type: "integer" } },
        required: ["speaker", "startSlide", "endSlide"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
} as const;
```

c) Add the function (uses the existing `SUMMARY_MODEL`):

```ts
export async function segmentSpeakers(client: Anthropic, slides: SlideText[]): Promise<SpeakerGroup[]> {
  const res: any = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 2048,
    output_config: { format: { type: "json_schema", schema: SEGMENT_SCHEMA } },
    messages: [{ role: "user", content: [{ type: "text", text: buildSpeakerSegmentPrompt(slides) }] }],
  } as any);
  if (res.stop_reason === "refusal") throw new Error("model refused to segment the deck");
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as { groups: SpeakerGroup[] };
  return normalizeSpeakerGroups(parsed.groups, slides.length);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/web && npx vitest run test/segment-speakers.test.ts test/slice-status.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/anthropic.ts packages/web/lib/status.ts packages/web/test/segment-speakers.test.ts packages/web/test/slice-status.test.ts
git commit -m "feat(web): Claude speaker segmentation client + slice status view

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Run directory helpers

**Files:**
- Create: `packages/web/lib/slice.ts`
- Create: `packages/web/test/slice-run.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `sanitizeRunId(id: string): string`
  - `newRunId(): string`
  - `runDir(runId: string): string`
  - `masterPdfPath(runId: string): string`
  - `deckPath(runId: string): string`
  - `outDir(runId: string): string`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/slice-run.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeRunId, newRunId, runDir, masterPdfPath, deckPath, outDir } from "../lib/slice";

describe("slice run helpers", () => {
  it("strips path traversal and unsafe chars from run ids", () => {
    expect(sanitizeRunId("../../etc/passwd")).toBe("etcpasswd");
    expect(sanitizeRunId("abc-123_XY")).toBe("abc-123_XY");
  });
  it("builds paths under data/slice/<runId>", () => {
    expect(runDir("r1").endsWith("data/slice/r1")).toBe(true);
    expect(deckPath("r1").endsWith("data/slice/r1/deck.pptx")).toBe(true);
    expect(masterPdfPath("r1").endsWith("data/slice/r1/deck.pdf")).toBe(true);
    expect(outDir("r1").endsWith("data/slice/r1/out")).toBe(true);
  });
  it("generates unique-ish run ids", () => {
    expect(newRunId()).not.toBe(newRunId());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run test/slice-run.test.ts`
Expected: FAIL — cannot find module `../lib/slice`.

- [ ] **Step 3: Write the implementation**

Create `packages/web/lib/slice.ts`:

```ts
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

export function sanitizeRunId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function newRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function runDir(runId: string): string {
  return resolve("data/slice", sanitizeRunId(runId));
}

export function deckPath(runId: string): string {
  return resolve(runDir(runId), "deck.pptx");
}

export function masterPdfPath(runId: string): string {
  return resolve(runDir(runId), "deck.pdf");
}

export function outDir(runId: string): string {
  return resolve(runDir(runId), "out");
}
```

- [ ] **Step 4: Ensure the temp root is git-ignored**

Run: `grep -n "data/slice" .gitignore || echo "MISSING"`
If it prints `MISSING`, append `data/slice/` to `.gitignore`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/web && npx vitest run test/slice-run.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/slice.ts packages/web/test/slice-run.test.ts .gitignore
git commit -m "feat(web): ephemeral per-run temp dir helpers for slide slicer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Convert + segment routes

**Files:**
- Create: `packages/web/app/api/slice/convert/route.ts`
- Create: `packages/web/app/api/slice/segment/route.ts`

**Interfaces:**
- Consumes: `deckPath`, `masterPdfPath`, `runDir`, `newRunId` (`@/lib/slice`); `convertToPdf`, `readSlides` (`@/lib/pptx-convert`); `pdfPageCount` (`@/lib/pdf-slice`); `segmentSpeakers`, `visionClient` (`@/lib/anthropic`); `authedDriveClient` (`@/lib/google/oauth`); `makeDriveClient` (`@/lib/google/drive`).
- Produces (HTTP):
  - `POST /api/slice/convert` — body is either a raw `.pptx` upload with an `x-filename` header, or JSON `{ driveFileId: string }`. Returns `{ runId, pageCount, slides: SlideText[], filename }`.
  - `POST /api/slice/segment` — JSON `{ slides: SlideText[] }`. Returns `{ groups: SpeakerGroup[] }`.

- [ ] **Step 1: Write the convert route**

Create `packages/web/app/api/slice/convert/route.ts`:

```ts
import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { newRunId, runDir, deckPath, masterPdfPath } from "@/lib/slice";
import { convertToPdf, readSlides, findSoffice } from "@/lib/pptx-convert";
import { pdfPageCount } from "@/lib/pdf-slice";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";

export const runtime = "nodejs";

function safeName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "deck";
  return base.toLowerCase().endsWith(".pptx") ? base : `${base}.pptx`;
}

export async function POST(request: Request) {
  if (!findSoffice()) {
    return NextResponse.json({ error: "LibreOffice is not installed. See the tool page for install steps." }, { status: 400 });
  }

  const runId = newRunId();
  const dir = runDir(runId);
  await mkdir(dir, { recursive: true });
  const pptx = deckPath(runId);
  let filename = "deck.pptx";

  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const { driveFileId } = await request.json();
      if (!driveFileId) return NextResponse.json({ error: "driveFileId required" }, { status: 400 });
      const drive = await authedDriveClient(getDb());
      if (!drive) return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });
      const bytes = await makeDriveClient(drive).downloadFile(driveFileId);
      await writeFile(pptx, bytes);
      filename = "deck.pptx";
    } else {
      const raw = request.headers.get("x-filename");
      if (!raw) return NextResponse.json({ error: "x-filename header required" }, { status: 400 });
      if (!request.body) return NextResponse.json({ error: "empty body" }, { status: 400 });
      filename = safeName(raw);
      await pipeline(Readable.fromWeb(request.body as any), createWriteStream(pptx));
    }

    await convertToPdf(pptx, dir);
    const slides = await readSlides(pptx);
    const pageCount = await pdfPageCount(await readFile(masterPdfPath(runId)));

    return NextResponse.json({ runId, pageCount, slides, filename });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the segment route**

Create `packages/web/app/api/slice/segment/route.ts`:

```ts
import { NextResponse } from "next/server";
import { visionClient, segmentSpeakers } from "@/lib/anthropic";
import type { SlideText } from "@event-editor/core/pptx";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 400 });
  }
  try {
    const { slides } = (await request.json()) as { slides: SlideText[] };
    if (!Array.isArray(slides) || slides.length === 0) {
      return NextResponse.json({ error: "slides required" }, { status: 400 });
    }
    const groups = await segmentSpeakers(visionClient(), slides);
    return NextResponse.json({ groups });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify the imports resolve (typecheck)**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no errors from the two new route files. (`visionClient` returns a bare `new Anthropic()`, which is the same client `segmentSpeakers` expects.)

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/api/slice/convert/route.ts packages/web/app/api/slice/segment/route.ts
git commit -m "feat(web): slice convert (upload/drive) + speaker segment API routes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Export + download + zip routes

**Files:**
- Create: `packages/web/app/api/slice/export/route.ts`
- Create: `packages/web/app/api/slice/[runId]/file/[name]/route.ts`
- Create: `packages/web/app/api/slice/[runId]/zip/route.ts`

**Interfaces:**
- Consumes: `masterPdfPath`, `outDir`, `sanitizeRunId` (`@/lib/slice`); `buildOutputs` (`@/lib/pdf-slice`); `planSlices`, `GroupInput` (`@event-editor/core/slice-plan`); `archiver` (existing dep).
- Produces (HTTP):
  - `POST /api/slice/export` — JSON `{ runId, groups: GroupInput[], confidential: boolean, watermarkText?: string }`. Writes PDFs to `outDir(runId)`, returns `{ files: { label, filename }[], warnings: string[] }`.
  - `GET /api/slice/[runId]/file/[name]` — streams one output PDF.
  - `GET /api/slice/[runId]/zip` — streams a zip of all output PDFs.

- [ ] **Step 1: Write the export route**

Create `packages/web/app/api/slice/export/route.ts`:

```ts
import { NextResponse } from "next/server";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { masterPdfPath, outDir } from "@/lib/slice";
import { buildOutputs } from "@/lib/pdf-slice";
import { planSlices, type GroupInput } from "@event-editor/core/slice-plan";
import { pdfPageCount } from "@/lib/pdf-slice";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { runId, groups, confidential, watermarkText } = (await request.json()) as {
      runId: string;
      groups: GroupInput[];
      confidential: boolean;
      watermarkText?: string;
    };
    if (!runId || !Array.isArray(groups)) {
      return NextResponse.json({ error: "runId and groups required" }, { status: 400 });
    }

    const master = await readFile(masterPdfPath(runId));
    const pageCount = await pdfPageCount(master);
    const plan = planSlices(groups, pageCount);
    if (plan.groups.length === 0) {
      return NextResponse.json({ error: "No exportable portions.", warnings: plan.warnings }, { status: 400 });
    }

    const dir = outDir(runId);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const outputs = await buildOutputs(master, plan.groups, {
      confidential: !!confidential,
      watermarkText: watermarkText ?? "CONFIDENTIAL",
    });
    for (const o of outputs) await writeFile(join(dir, o.filename), Buffer.from(o.bytes));

    return NextResponse.json({
      files: outputs.map((o) => ({ label: o.label, filename: o.filename })),
      warnings: plan.warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the single-file download route**

Create `packages/web/app/api/slice/[runId]/file/[name]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { outDir } from "@/lib/slice";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string; name: string }> }) {
  const { runId, name } = await ctx.params;
  const safe = basename(name); // block path traversal
  try {
    const bytes = await readFile(join(outDir(runId), safe));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${safe}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
```

- [ ] **Step 3: Write the zip route**

Create `packages/web/app/api/slice/[runId]/zip/route.ts` (mirror the existing batch zip route's archiver usage in `packages/web/app/api/studio/batch/[batchId]/zip/route.ts`):

```ts
import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import archiver from "archiver";
import { outDir } from "@/lib/slice";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const dir = outDir(runId);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".pdf"));
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (names.length === 0) return NextResponse.json({ error: "nothing to zip" }, { status: 404 });

  const archive = archiver("zip", { zlib: { level: 9 } });
  const stream = new ReadableStream({
    start(controller) {
      archive.on("data", (c: Buffer) => controller.enqueue(new Uint8Array(c)));
      archive.on("end", () => controller.close());
      archive.on("error", (e: Error) => controller.error(e));
      (async () => {
        for (const n of names) archive.append(await readFile(join(dir, n)), { name: n });
        await archive.finalize();
      })();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="slices-${runId}.zip"`,
    },
  });
}
```

- [ ] **Step 4: Confirm the zip pattern matches the existing batch route**

Run: `sed -n '1,60p' packages/web/app/api/studio/batch/[batchId]/zip/route.ts`
Expected: same `archiver` + streaming shape. If the existing route uses a different streaming approach (e.g. `Readable.toWeb`), match that instead so the codebase stays consistent.

- [ ] **Step 5: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no errors from the three new files.

- [ ] **Step 6: Commit**

```bash
git add "packages/web/app/api/slice/export/route.ts" "packages/web/app/api/slice/[runId]/file/[name]/route.ts" "packages/web/app/api/slice/[runId]/zip/route.ts"
git commit -m "feat(web): slice export + per-file + zip download routes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Drive-save route

**Files:**
- Create: `packages/web/app/api/slice/drive-save/route.ts`

**Interfaces:**
- Consumes: `outDir` (`@/lib/slice`); `authedDriveClient` (`@/lib/google/oauth`); `makeDriveClient` (`@/lib/google/drive`); `getDb` (`@/lib/db`).
- Produces (HTTP): `POST /api/slice/drive-save` — JSON `{ runId, folderId }`. Uploads every output PDF, returns `{ uploaded: { filename, url }[] }`.

- [ ] **Step 1: Write the route**

Create `packages/web/app/api/slice/drive-save/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { outDir } from "@/lib/slice";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { runId, folderId } = (await request.json()) as { runId: string; folderId: string };
    if (!runId || !folderId) return NextResponse.json({ error: "runId and folderId required" }, { status: 400 });

    const drive = await authedDriveClient(getDb());
    if (!drive) return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });
    const client = makeDriveClient(drive);

    const dir = outDir(runId);
    const names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".pdf"));
    if (names.length === 0) return NextResponse.json({ error: "nothing to save" }, { status: 404 });

    const uploaded: { filename: string; url: string }[] = [];
    for (const n of names) {
      const bytes = await readFile(join(dir, n));
      const res = await client.uploadPdf(n, new Uint8Array(bytes), folderId);
      uploaded.push({ filename: n, url: res.url });
    }
    return NextResponse.json({ uploaded });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/api/slice/drive-save/route.ts
git commit -m "feat(web): slice drive-save route uploads output PDFs to a Drive folder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Slice tool UI + navigation wiring

**Files:**
- Create: `packages/web/app/slice/page.tsx`
- Create: `packages/web/app/slice/SliceClient.tsx`
- Modify: `packages/web/components/Nav.tsx` (add the Slide Slicer link)
- Modify: `packages/web/app/page.tsx` (add the home tool card + fix the "Three tools" copy)

**Interfaces:**
- Consumes: all `/api/slice/*` routes; `SlideText`, `SpeakerGroup` (`@event-editor/core/pptx`); `StatusBadge`, `FileDrop`, `Segmented`; `sliceStatusView` (`@/lib/status`).
- Produces: no exported API; the user-facing tool.

This task has no unit tests (the repo does not unit-test React components; logic is already covered in Tasks 2 to 11). Verify with typecheck + a manual dev-server walkthrough.

- [ ] **Step 1: Add the server page (gate + LibreOffice check)**

Create `packages/web/app/slice/page.tsx`:

```tsx
import { getConnections } from "@event-editor/core/settings";
import { findSoffice } from "@/lib/pptx-convert";
import { SliceClient } from "./SliceClient";

export const dynamic = "force-dynamic";

export default function SlicePage() {
  const conns = getConnections();
  const anthropic = conns.find((c) => c.id === "anthropic");
  const soffice = !!findSoffice();

  return (
    <div>
      <p className="eyebrow">Slide slicer</p>
      <h1 className="mt-1 text-2xl font-semibold">Slice a deck into confidential PDFs</h1>

      {!soffice ? (
        <div className="card mt-8">
          <p className="font-medium">LibreOffice is required</p>
          <p className="mt-2 text-muted">
            This tool converts PowerPoint to PDF locally with LibreOffice so confidential decks never leave your machine.
          </p>
          <p className="mt-2 text-muted">
            Install it from libreoffice.org (or `brew install --cask libreoffice` on macOS), then restart this app.
          </p>
        </div>
      ) : !anthropic?.configured ? (
        <div className="card mt-8">
          <p className="text-muted">Set ANTHROPIC_API_KEY in .env to use speaker segmentation, then restart. Manual page slicing works without it.</p>
          <SliceClient hasAi={false} />
        </div>
      ) : (
        <div className="mt-8">
          <SliceClient hasAi={true} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the client component**

Create `packages/web/app/slice/SliceClient.tsx`:

```tsx
"use client";
import { useRef, useState } from "react";
import { Plus, X, Download, FileArchive, UploadCloud } from "lucide-react";
import { FileDrop } from "@/components/FileDrop";
import { StatusBadge } from "@/components/StatusBadge";
import { sliceStatusView } from "@/lib/status";
import type { SlideText, SpeakerGroup } from "@event-editor/core/pptx";

interface GroupRow { label: string; ranges: string }
interface OutFile { label: string; filename: string }

export function SliceClient({ hasAi }: { hasAi: boolean }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [slides, setSlides] = useState<SlideText[]>([]);

  const [mode, setMode] = useState<"manual" | "speaker">("manual");
  const [rows, setRows] = useState<GroupRow[]>([{ label: "Part 1", ranges: "" }]);

  const [confidential, setConfidential] = useState(false);
  const [watermark, setWatermark] = useState("CONFIDENTIAL");

  const [files, setFiles] = useState<OutFile[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [driveFolder, setDriveFolder] = useState("");
  const [saved, setSaved] = useState<{ filename: string; url: string }[]>([]);

  const busy = ["converting", "reading", "segmenting", "exporting", "saving"].includes(status);

  async function convert() {
    const f = fileRef.current?.files?.[0];
    if (!f) { setError("Choose a .pptx file first."); return; }
    setError(null);
    setStatus("converting");
    setFiles([]); setSaved([]); setWarnings([]);
    try {
      const r = await fetch("/api/slice/convert", { method: "POST", headers: { "x-filename": f.name }, body: f });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Conversion failed");
      setRunId(data.runId);
      setPageCount(data.pageCount);
      setSlides(data.slides);
      setRows([{ label: "Part 1", ranges: `1-${data.pageCount}` }]);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function segment() {
    if (!slides.length) return;
    setError(null);
    setStatus("segmenting");
    try {
      const r = await fetch("/api/slice/segment", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slides }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Segmentation failed");
      const groups: SpeakerGroup[] = data.groups;
      setRows(groups.map((g) => ({ label: g.speaker, ranges: g.startSlide === g.endSlide ? `${g.startSlide}` : `${g.startSlide}-${g.endSlide}` })));
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function exportPdfs() {
    if (!runId) return;
    setError(null);
    setStatus("exporting");
    setSaved([]);
    try {
      const r = await fetch("/api/slice/export", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, groups: rows, confidential, watermarkText: watermark }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Export failed");
      setFiles(data.files);
      setWarnings(data.warnings ?? []);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function saveToDrive() {
    if (!runId || !driveFolder.trim()) { setError("Enter a Drive folder id to save."); return; }
    setError(null);
    setStatus("saving");
    try {
      const r = await fetch("/api/slice/drive-save", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, folderId: driveFolder.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Drive save failed");
      setSaved(data.uploaded);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function reset() {
    setRunId(null); setPageCount(0); setSlides([]); setFiles([]); setSaved([]);
    setWarnings([]); setStatus("idle"); setError(null);
    setRows([{ label: "Part 1", ranges: "" }]);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-5">
      {/* Input */}
      <div className="card">
        <p className="eyebrow">1. Choose a deck</p>
        <div className="mt-3">
          <FileDrop inputRef={fileRef} accept=".pptx" label="Drop a .pptx here, or click to browse" />
        </div>
        <p className="mt-2 text-xs text-muted">
          Prefer Google Drive? Paste a deck file id here and it converts the same way. Drive-picker UI can come later.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" className="btn btn-accent" onClick={convert} disabled={busy}>
            {status === "converting" ? "Converting…" : "Convert to PDF"}
          </button>
          {status !== "idle" && <StatusBadge {...sliceStatusView(status)} />}
        </div>
      </div>

      {runId && (
        <>
          {/* Slicing */}
          <div className="card">
            <p className="eyebrow">2. Choose the slices</p>
            <p className="mt-1 text-sm text-muted">This deck has {pageCount} pages.</p>

            <div className="mt-3 inline-flex rounded-lg border border-line p-1">
              <button type="button" onClick={() => setMode("manual")}
                className={`rounded-md px-3 py-1.5 text-sm ${mode === "manual" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}>
                Manual page ranges
              </button>
              <button type="button" onClick={() => setMode("speaker")}
                className={`rounded-md px-3 py-1.5 text-sm ${mode === "speaker" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}>
                By speaker
              </button>
            </div>

            {mode === "speaker" && (
              <div className="mt-3">
                <button type="button" className="btn" onClick={segment} disabled={busy || !hasAi}>
                  {status === "segmenting" ? "Finding portions…" : "Suggest speaker portions"}
                </button>
                {!hasAi && <span className="ml-2 text-sm text-muted">Set ANTHROPIC_API_KEY to enable this.</span>}
                <p className="mt-2 text-xs text-muted">Suggestions drop into the rows below. Review and adjust before exporting.</p>
              </div>
            )}

            <div className="mt-4 space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input className="field flex-1" placeholder="Portion name" value={row.label}
                    onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, label: e.target.value } : r))} />
                  <input className="field w-40" placeholder="Pages e.g. 1-5, 8" value={row.ranges}
                    onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, ranges: e.target.value } : r))} />
                  <button type="button" className="btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
                </div>
              ))}
              <button type="button" className="btn inline-flex items-center gap-2" onClick={() => setRows([...rows, { label: `Part ${rows.length + 1}`, ranges: "" }])}>
                <Plus className="w-4 h-4" /> Add portion
              </button>
            </div>
          </div>

          {/* Confidential */}
          <div className="card">
            <p className="eyebrow">3. Confidential watermark</p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
              Stamp every page with a confidential watermark
            </label>
            {confidential && (
              <label className="mt-3 block text-sm font-medium">Watermark text
                <input className="field mt-1 w-full max-w-xs" value={watermark} onChange={(e) => setWatermark(e.target.value)} />
              </label>
            )}
          </div>

          {/* Export */}
          <div className="card">
            <p className="eyebrow">4. Export</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-accent" onClick={exportPdfs} disabled={busy}>
                {status === "exporting" ? "Building…" : "Build PDFs"}
              </button>
              <button type="button" className="btn" onClick={reset} disabled={busy}>Start over</button>
              {status !== "idle" && <StatusBadge {...sliceStatusView(status)} />}
            </div>

            {warnings.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-warning">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}

            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                {files.map((f) => (
                  <div key={f.filename} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                    <span className="text-sm">{f.label} <span className="text-muted">({f.filename})</span></span>
                    <a className="btn inline-flex items-center gap-2" href={`/api/slice/${runId}/file/${encodeURIComponent(f.filename)}`}>
                      <Download className="w-4 h-4" /> Download
                    </a>
                  </div>
                ))}
                <a className="btn btn-accent inline-flex items-center gap-2" href={`/api/slice/${runId}/zip`}>
                  <FileArchive className="w-4 h-4" /> Download all as zip
                </a>

                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-sm font-medium">Save to Google Drive</p>
                  <p className="text-xs text-muted">Optional. Sends the output PDFs to a Drive folder.</p>
                  <div className="mt-2 flex gap-2">
                    <input className="field flex-1" placeholder="Drive folder id" value={driveFolder} onChange={(e) => setDriveFolder(e.target.value)} />
                    <button type="button" className="btn inline-flex items-center gap-2" onClick={saveToDrive} disabled={busy}>
                      <UploadCloud className="w-4 h-4" /> Save
                    </button>
                  </div>
                  {saved.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-sm text-success">
                      {saved.map((s) => <li key={s.filename}><a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.filename}</a></li>)}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
```

Note: if `text-warning` is not a defined token (see Task 1 Step 2), replace the two `text-warning` usages here with `text-amber-600`.

- [ ] **Step 3: Add the Nav link**

In `packages/web/components/Nav.tsx`:

a) Add `Scissors` to the lucide import:

```tsx
import { Home, Images, Mic, UserRound, Settings, LayoutGrid, Scissors, type LucideIcon } from "lucide-react";
```

b) Add this entry to `LINKS` (after the Batch entry, before Settings):

```tsx
  { href: "/slice", label: "Slide slicer", Icon: Scissors },
```

- [ ] **Step 4: Add the home tool card**

In `packages/web/app/page.tsx`:

a) Change the eyebrow copy from `Three tools, one workspace` to `Four tools, one workspace`.

b) Change `sm:grid-cols-3` to `sm:grid-cols-2` on the grid div (four cards read better 2-up than a cramped 4-up; keep the existing `gap-5`).

c) Add this card after the transcriber `ToolCard`:

```tsx
        <ToolCard
          href="/slice"
          eyebrow="Slide slicer"
          title="Slice a deck into confidential PDFs"
          body="Convert a PowerPoint to PDF, split it by page ranges or by speaker, and stamp each page confidential."
        />
```

- [ ] **Step 5: Typecheck + build**

Run: `cd packages/web && npx tsc --noEmit && npm run build`
Expected: typecheck clean; `next build` succeeds (all `/api/slice/*` routes compile).

- [ ] **Step 6: Manual dev-server walkthrough**

Run from repo root: `npm run dev`
Then in the browser:
1. Open `http://localhost:3000/slice`.
2. If LibreOffice is installed, the tool renders; otherwise the install card shows (expected on a machine without it).
3. Upload a small `.pptx`, click Convert to PDF. Confirm page count appears and Part 1 defaults to `1-<pageCount>`.
4. Manual mode: set two portions (e.g. `1-2` and `3-`), tick Confidential, Build PDFs. Download one and the zip; confirm the watermark appears on each page.
5. By speaker mode: click Suggest speaker portions; confirm rows populate and are editable.
6. Optional: paste a Drive folder id, Save, confirm links appear.

Record the result (pass/fail per step) in the task notes.

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/slice/page.tsx packages/web/app/slice/SliceClient.tsx packages/web/components/Nav.tsx packages/web/app/page.tsx
git commit -m "feat(web): slide slicer tool page, client UI, nav + home wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** input both upload+Drive (Task 9 convert handles both; Drive-picker UI deferred to a folder-id field in Task 12, called out inline), LibreOffice conversion (Task 5), per-slide text for AI (Task 5), manual + speaker slicing (Tasks 2, 3, 7, 12), confidential watermark with editable text (Task 4, 12), delivery download+zip+Drive (Tasks 10, 11, 12), ephemeral no-db (Task 8), transcription save nudge (Task 1), LibreOffice detection/gate (Tasks 5, 12), status surfacing (Task 7). All covered.
- **Deferred vs spec:** the spec said Drive *picker*; this plan ships Drive *by file id* input to keep scope bounded, with a note that a picker can follow. Flagged in Task 12 Step 2 copy. Confirm this is acceptable during execution; a picker would reuse `listPresentations` (already built in Task 6) and the sorter's folder-list pattern.
- **Type consistency:** `SlideText`/`SpeakerGroup` defined in Task 3, consumed unchanged in Tasks 5, 7, 9, 12. `GroupInput`/`PlannedGroup`/`SlicePlan` defined in Task 2, consumed in Tasks 4, 10. `OutputFile` defined in Task 4, used in Task 10. `runId`/`runDir` naming consistent across Tasks 8 to 12.
- **Placeholder scan:** no TBDs; every code step contains complete code.
