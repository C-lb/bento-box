# Batch F — Event document generators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four event-document generators (`/certificate`, `/badge`, `/place-card`, `/ticket`) that merge an attendee list into personalised, print-ready files, all rendered client-side.

**Architecture:** One shared merge engine — list parsing, column→field mapping, and pdf-lib rendering — with four thin, opinionated tool front-ends. Pure logic (types, parsing, field substitution, layout→spec) lives in `@event-editor/core`; the browser-only rendering and React UI live in `packages/web`. Attendee PII stays on the machine; only the optional Google Sheet fetch touches a thin server route, and it renders nothing.

**Tech Stack:** Next.js 16 (App Router), React client components, TypeScript, `pdf-lib` + `@pdf-lib/fontkit` (rendering), `xlsx` SheetJS (spreadsheet parsing), `jszip` (packaging), `qrcode` (badge/ticket QR, F2), vitest.

## Global Constraints

- **Monorepo, two packages.** Pure/testable logic → `packages/core/src/*.ts`, exported via a `./name` entry in `packages/core/package.json` `exports` and built to `dist/`. React + heavy runtime libs → `packages/web`.
- **Rebuild core after changing it.** Web imports the built `dist/`, not `src/`. After editing any `packages/core/src` file run `npm run build -w @event-editor/core` (or the repo's core build) before the web app or a web test will see the change.
- **Import core via subpaths**, e.g. `import { resolveText } from "@event-editor/core/merge"`. Never deep-import `dist/` paths directly.
- **Turbopack: no extensionless relative imports** inside a package that get bundled — but core's own internal imports use explicit `.js` (e.g. `./schema/index.js`). Match the file you are editing.
- **Rendering is client-side.** No attendee data in any server route except `/api/sheet`, which returns rows and stores nothing.
- **License gate on every new dep** (batch-E lesson). Batch F adds only: `xlsx` (SheetJS community, Apache-2.0), `@pdf-lib/fontkit` (MIT), bundled Google Fonts (OFL). No AGPL / non-commercial.
- **Copy rules (anti-vibecode / house):** sentence-case labels, no ALL-CAPS eyebrows, no em dashes in UI copy. Danger text uses `text-danger`; warnings use `text-amber-600` (NOT `text-warning`).
- **Reuse, don't duplicate:** filenames via `safeBase`/`swapExt` from `@event-editor/core/names`; Google Sheet reads via `packages/web/lib/google/sheets.ts`.

---

## File Structure

**F1 (this plan, detailed):**

- Create `packages/core/src/merge.ts` — pure merge types + `resolveText`, `parseDelimited`, `autoMatchColumns`, `deriveFields`.
- Create `packages/core/src/merge.test.ts` — unit tests for the above.
- Create `packages/core/src/certificate.ts` — `CERTIFICATE_LAYOUTS`, `certificateSpec(opts)`.
- Create `packages/core/src/certificate.test.ts` — unit tests.
- Modify `packages/core/src/index.ts` — re-export new modules.
- Modify `packages/core/package.json` — add `./merge` and `./certificate` export entries.
- Create `packages/web/lib/merge-xlsx.ts` — `parseWorkbook(ArrayBuffer)` via SheetJS.
- Create `packages/web/lib/merge-xlsx.test.ts`.
- Create `packages/web/lib/merge-render.ts` — `renderCombined`, `renderZip`, font loading (pdf-lib + fontkit + jszip).
- Create `packages/web/lib/merge-render.test.ts`.
- Create `packages/web/app/api/sheet/route.ts` — POST `{ url }` → `{ headers, rows }`.
- Create `packages/web/lib/sheet-url.ts` + `.test.ts` — pure Sheet-URL → id/gid parser.
- Create `packages/web/app/certificate/page.tsx` and `CertificateClient.tsx` — the UI.
- Modify `packages/web/components/tools.ts` — register the certificate tool.
- Add `packages/web/public/fonts/*.ttf` — two bundled OFL fonts.

**F2 / F3 (outlined at the end):** badge/place-card/ticket front-ends, N-up tiling, QR, and the upload-your-own-background canvas editor.

---

## Types (shared contract, defined in Task 1)

```ts
// packages/core/src/merge.ts
export type Rows = { headers: string[]; rows: Record<string, string>[] };
export type Align = "left" | "center" | "right";
export interface PageSize { width: number; height: number } // PDF points (72 = 1in)

export interface TextElement {
  kind: "text";
  template: string;   // literal text; "{Header}" tokens substituted per row
  x: number;          // points from left
  y: number;          // points from bottom (pdf-lib origin is bottom-left)
  size: number;       // font size, points
  font: "heading" | "body";
  align: Align;       // horizontal anchor at x
  color: string;      // "#rrggbb"
}
export interface ImageElement {
  kind: "image";
  src: string;        // data URL (constant across rows)
  x: number; y: number; width: number; height: number;
}
export type Element = TextElement | ImageElement;

export interface DocumentSpec {
  page: PageSize;
  background?: string; // optional full-page image data URL (F3 custom bg)
  elements: Element[];
}
```

---

### Task 1: Merge core — types + field substitution

**Files:**
- Create: `packages/core/src/merge.ts`
- Test: `packages/core/src/merge.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the types above, plus `resolveText(template: string, row: Record<string,string>): string`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/merge.test.ts
import { describe, it, expect } from "vitest";
import { resolveText } from "./merge.js";

describe("resolveText", () => {
  it("substitutes a token with the matching column value", () => {
    expect(resolveText("Awarded to {Name}", { Name: "Ada Lovelace" }))
      .toBe("Awarded to Ada Lovelace");
  });
  it("matches column names case-insensitively", () => {
    expect(resolveText("{name}", { Name: "Ada" })).toBe("Ada");
  });
  it("replaces an unknown token with an empty string", () => {
    expect(resolveText("Hi {Missing}!", { Name: "Ada" })).toBe("Hi !");
  });
  it("leaves text with no tokens untouched", () => {
    expect(resolveText("Certificate of Completion", {})).toBe("Certificate of Completion");
  });
  it("substitutes multiple tokens", () => {
    expect(resolveText("{Name} — {Org}", { Name: "Ada", Org: "Analytical" }))
      .toBe("Ada — Analytical");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @event-editor/core -- merge`
Expected: FAIL — cannot find module `./merge.js` / `resolveText` is not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/merge.ts
export type Rows = { headers: string[]; rows: Record<string, string>[] };
export type Align = "left" | "center" | "right";
export interface PageSize { width: number; height: number }

export interface TextElement {
  kind: "text";
  template: string;
  x: number; y: number; size: number;
  font: "heading" | "body";
  align: Align;
  color: string;
}
export interface ImageElement {
  kind: "image";
  src: string;
  x: number; y: number; width: number; height: number;
}
export type Element = TextElement | ImageElement;

export interface DocumentSpec {
  page: PageSize;
  background?: string;
  elements: Element[];
}

/** Replace `{Header}` tokens with the row's value (case-insensitive key match). */
export function resolveText(template: string, row: Record<string, string>): string {
  const lower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const v = lower.get(key.trim().toLowerCase());
    return v == null ? "" : String(v);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @event-editor/core -- merge`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/merge.ts packages/core/src/merge.test.ts
git commit -m "feat(merge): core types and field substitution"
```

---

### Task 2: Merge core — parse pasted / delimited text

**Files:**
- Modify: `packages/core/src/merge.ts`
- Test: `packages/core/src/merge.test.ts`

**Interfaces:**
- Consumes: `Rows` from Task 1.
- Produces: `parseDelimited(text: string): Rows`. Splits on tab or comma; if a single column, names it `Name`; first line is treated as a header only when it contains no value that looks like data — to keep it deterministic, the first line is ALWAYS the header when there is more than one line, else a single value becomes one row under header `Name`.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/core/src/merge.test.ts
import { parseDelimited } from "./merge.js";

describe("parseDelimited", () => {
  it("treats a single column of lines as Name rows (first line is header)", () => {
    const out = parseDelimited("Name\nAda\nGrace");
    expect(out.headers).toEqual(["Name"]);
    expect(out.rows).toEqual([{ Name: "Ada" }, { Name: "Grace" }]);
  });
  it("names a headerless single value column 'Name'", () => {
    const out = parseDelimited("Ada");
    expect(out.headers).toEqual(["Name"]);
    expect(out.rows).toEqual([{ Name: "Ada" }]);
  });
  it("parses tab-separated columns with the first row as header", () => {
    const out = parseDelimited("Name\tOrg\nAda\tAnalytical\nGrace\tNavy");
    expect(out.headers).toEqual(["Name", "Org"]);
    expect(out.rows).toEqual([
      { Name: "Ada", Org: "Analytical" },
      { Name: "Grace", Org: "Navy" },
    ]);
  });
  it("parses comma-separated columns", () => {
    const out = parseDelimited("Name,Org\nAda,Analytical");
    expect(out.rows).toEqual([{ Name: "Ada", Org: "Analytical" }]);
  });
  it("ignores blank lines and trims cells", () => {
    const out = parseDelimited("Name\n Ada \n\nGrace\n");
    expect(out.rows).toEqual([{ Name: "Ada" }, { Name: "Grace" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @event-editor/core -- merge`
Expected: FAIL — `parseDelimited` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to packages/core/src/merge.ts
export function parseDelimited(text: string): Rows {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const delim = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : null;

  // Single value, no delimiter, one line -> one Name row, no header line.
  if (delim === null && lines.length === 1) {
    return { headers: ["Name"], rows: [{ Name: lines[0] }] };
  }

  const split = (l: string) => (delim ? l.split(delim).map((c) => c.trim()) : [l]);
  const headers = delim ? split(lines[0]) : ["Name"];
  const bodyStart = delim ? 1 : 1; // first line is always header for multi-line input
  const dataLines = delim ? lines.slice(1) : lines.slice(1);

  const rows = dataLines.map((l) => {
    const cells = split(l);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @event-editor/core -- merge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/merge.ts packages/core/src/merge.test.ts
git commit -m "feat(merge): parse pasted/delimited attendee lists"
```

---

### Task 3: Merge core — field discovery + column auto-match

**Files:**
- Modify: `packages/core/src/merge.ts`
- Test: `packages/core/src/merge.test.ts`

**Interfaces:**
- Consumes: `DocumentSpec`, `Rows`.
- Produces:
  - `deriveFields(spec: DocumentSpec): string[]` — every distinct `{Token}` used by the spec's text elements, in first-seen order.
  - `autoMatchColumns(fields: string[], headers: string[]): Record<string, string | null>` — best header per field by normalized equality then a small synonym table; unmatched → `null`; a header is used at most once.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/core/src/merge.test.ts
import { deriveFields, autoMatchColumns } from "./merge.js";
import type { DocumentSpec } from "./merge.js";

const spec: DocumentSpec = {
  page: { width: 100, height: 100 },
  elements: [
    { kind: "text", template: "To {Name}", x: 0, y: 0, size: 12, font: "heading", align: "left", color: "#000000" },
    { kind: "text", template: "{Name} of {Org}", x: 0, y: 0, size: 12, font: "body", align: "left", color: "#000000" },
    { kind: "text", template: "Static line", x: 0, y: 0, size: 12, font: "body", align: "left", color: "#000000" },
  ],
};

describe("deriveFields", () => {
  it("returns distinct tokens in first-seen order", () => {
    expect(deriveFields(spec)).toEqual(["Name", "Org"]);
  });
  it("returns empty when there are no tokens", () => {
    expect(deriveFields({ page: { width: 1, height: 1 }, elements: [] })).toEqual([]);
  });
});

describe("autoMatchColumns", () => {
  it("matches on exact (case-insensitive) header name", () => {
    expect(autoMatchColumns(["Name", "Org"], ["name", "ORG"]))
      .toEqual({ Name: "name", Org: "ORG" });
  });
  it("matches via synonyms", () => {
    expect(autoMatchColumns(["Org"], ["Company"])).toEqual({ Org: "Company" });
  });
  it("returns null for an unmatched field", () => {
    expect(autoMatchColumns(["Name"], ["Email"])).toEqual({ Name: null });
  });
  it("never assigns one header to two fields", () => {
    const m = autoMatchColumns(["Name", "Recipient"], ["Name"]);
    const used = Object.values(m).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @event-editor/core -- merge`
Expected: FAIL — `deriveFields` / `autoMatchColumns` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to packages/core/src/merge.ts
export function deriveFields(spec: DocumentSpec): string[] {
  const seen: string[] = [];
  for (const el of spec.elements) {
    if (el.kind !== "text") continue;
    for (const m of el.template.matchAll(/\{([^}]+)\}/g)) {
      const f = m[1].trim();
      if (!seen.includes(f)) seen.push(f);
    }
  }
  return seen;
}

const FIELD_SYNONYMS: Record<string, string[]> = {
  name: ["name", "full name", "recipient", "attendee"],
  org: ["org", "organisation", "organization", "company", "employer"],
  role: ["role", "title", "position", "job title"],
  date: ["date", "day"],
  email: ["email", "e-mail", "mail"],
};

export function autoMatchColumns(
  fields: string[],
  headers: string[],
): Record<string, string | null> {
  const norm = (s: string) => s.trim().toLowerCase();
  const taken = new Set<string>();
  const out: Record<string, string | null> = {};
  for (const field of fields) {
    const fn = norm(field);
    // 1) exact case-insensitive header
    let hit = headers.find((h) => !taken.has(h) && norm(h) === fn);
    // 2) synonym table (field's synonyms, or the field name itself)
    if (!hit) {
      const syns = FIELD_SYNONYMS[fn] ?? [fn];
      hit = headers.find((h) => !taken.has(h) && syns.includes(norm(h)));
    }
    out[field] = hit ?? null;
    if (hit) taken.add(hit);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @event-editor/core -- merge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/merge.ts packages/core/src/merge.test.ts
git commit -m "feat(merge): field discovery and column auto-match"
```

---

### Task 4: Certificate layouts → DocumentSpec

**Files:**
- Create: `packages/core/src/certificate.ts`
- Test: `packages/core/src/certificate.test.ts`

**Interfaces:**
- Consumes: `DocumentSpec`, `TextElement` from `./merge.js`.
- Produces:
  - `CERTIFICATE_LAYOUTS: readonly { id: "classic"|"modern"|"minimal"; label: string }[]`
  - `certificateSpec(opts: CertificateOptions): DocumentSpec` where
    ```ts
    export interface CertificateOptions {
      layout: "classic" | "modern" | "minimal";
      title: string;        // constant, e.g. "Certificate of Completion"
      bodyLine: string;     // constant, e.g. "This certifies that"
      recipientField: string; // header key, becomes "{Field}" token; default "Name"
      detailLine: string;   // constant, e.g. "has completed the SPARK AI Literacy workshop"
      dateText: string;     // constant
      signatureName?: string;
    }
    ```
- Page is always A4 landscape: `{ width: 841.89, height: 595.28 }`. Recipient element uses `font: "heading"`, centered. The three layouts differ in sizes/positions and element count (minimal omits signature).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/certificate.test.ts
import { describe, it, expect } from "vitest";
import { certificateSpec, CERTIFICATE_LAYOUTS } from "./certificate.js";
import { deriveFields } from "./merge.js";

const base = {
  title: "Certificate of Completion",
  bodyLine: "This certifies that",
  recipientField: "Name",
  detailLine: "has completed the workshop",
  dateText: "4 July 2026",
  signatureName: "SPARK",
} as const;

describe("certificateSpec", () => {
  it("is A4 landscape", () => {
    const s = certificateSpec({ ...base, layout: "classic" });
    expect(s.page.width).toBeCloseTo(841.89, 1);
    expect(s.page.height).toBeCloseTo(595.28, 1);
  });
  it("exposes the recipient as a mergeable {field} token", () => {
    const s = certificateSpec({ ...base, layout: "classic" });
    expect(deriveFields(s)).toContain("Name");
  });
  it("honours a custom recipient field name", () => {
    const s = certificateSpec({ ...base, recipientField: "Attendee", layout: "modern" });
    expect(deriveFields(s)).toContain("Attendee");
  });
  it("centers the recipient headline", () => {
    const s = certificateSpec({ ...base, layout: "classic" });
    const headline = s.elements.find(
      (e) => e.kind === "text" && e.template.includes("{Name}"),
    );
    expect(headline).toBeTruthy();
    expect(headline && headline.kind === "text" && headline.align).toBe("center");
  });
  it("minimal layout omits the signature line", () => {
    const min = certificateSpec({ ...base, layout: "minimal" });
    const hasSig = min.elements.some((e) => e.kind === "text" && e.template.includes("SPARK"));
    expect(hasSig).toBe(false);
  });
  it("classic layout includes the signature line", () => {
    const c = certificateSpec({ ...base, layout: "classic" });
    const hasSig = c.elements.some((e) => e.kind === "text" && e.template.includes("SPARK"));
    expect(hasSig).toBe(true);
  });
  it("lists three layouts", () => {
    expect(CERTIFICATE_LAYOUTS.map((l) => l.id)).toEqual(["classic", "modern", "minimal"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @event-editor/core -- certificate`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/certificate.ts
import type { DocumentSpec, TextElement } from "./merge.js";

export const CERTIFICATE_LAYOUTS = [
  { id: "classic", label: "Classic" },
  { id: "modern", label: "Modern" },
  { id: "minimal", label: "Minimal" },
] as const;

export type CertificateLayout = (typeof CERTIFICATE_LAYOUTS)[number]["id"];

export interface CertificateOptions {
  layout: CertificateLayout;
  title: string;
  bodyLine: string;
  recipientField: string;
  detailLine: string;
  dateText: string;
  signatureName?: string;
}

const A4_LANDSCAPE = { width: 841.89, height: 595.28 };
const CX = A4_LANDSCAPE.width / 2; // horizontal center

function text(
  template: string,
  y: number,
  size: number,
  font: "heading" | "body",
  color = "#1a1a1a",
): TextElement {
  return { kind: "text", template, x: CX, y, size, font, align: "center", color };
}

export function certificateSpec(opts: CertificateOptions): DocumentSpec {
  const recipient = `{${opts.recipientField || "Name"}}`;
  const accent = "#2563eb";
  const els: TextElement[] = [];

  if (opts.layout === "classic") {
    els.push(text(opts.title, 470, 30, "heading", accent));
    els.push(text(opts.bodyLine, 400, 15, "body", "#555555"));
    els.push(text(recipient, 340, 46, "heading"));
    els.push(text(opts.detailLine, 280, 16, "body", "#555555"));
    els.push(text(opts.dateText, 150, 13, "body", "#555555"));
    if (opts.signatureName) els.push(text(opts.signatureName, 110, 15, "heading"));
  } else if (opts.layout === "modern") {
    els.push(text(opts.title, 490, 24, "body", accent));
    els.push(text(recipient, 360, 54, "heading"));
    els.push(text(opts.bodyLine + " " + opts.detailLine, 300, 15, "body", "#555555"));
    els.push(text(opts.dateText, 150, 13, "body", "#888888"));
    if (opts.signatureName) els.push(text(opts.signatureName, 110, 15, "heading"));
  } else {
    // minimal — no signature
    els.push(text(opts.title, 460, 20, "body", "#888888"));
    els.push(text(recipient, 350, 50, "heading"));
    els.push(text(opts.detailLine, 290, 15, "body", "#555555"));
    els.push(text(opts.dateText, 160, 12, "body", "#888888"));
  }

  return { page: { ...A4_LANDSCAPE }, elements: els };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @event-editor/core -- certificate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/certificate.ts packages/core/src/certificate.test.ts
git commit -m "feat(certificate): three layouts as DocumentSpec builders"
```

---

### Task 5: Export the new core modules + rebuild

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json`

**Interfaces:**
- Produces: `@event-editor/core/merge` and `@event-editor/core/certificate` subpath entry points, resolvable from `packages/web`.

- [ ] **Step 1: Add re-exports to the barrel**

Open `packages/core/src/index.ts` and add (follow the existing `export * from "./x.js";` style):

```ts
export * from "./merge.js";
export * from "./certificate.js";
```

- [ ] **Step 2: Add subpath exports**

In `packages/core/package.json`, inside `"exports"`, add alongside the existing `"./qr"`, `"./cutout"` lines:

```json
    "./merge": "./dist/merge.js",
    "./certificate": "./dist/certificate.js"
```

- [ ] **Step 3: Build core and confirm the dist files exist**

Run: `npm run build -w @event-editor/core && ls packages/core/dist/merge.js packages/core/dist/certificate.js`
Expected: both paths listed, no build errors.

- [ ] **Step 4: Confirm the whole core suite still passes**

Run: `npm test -w @event-editor/core`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/package.json
git commit -m "feat(core): export merge and certificate modules"
```

---

### Task 6: Web — parse uploaded CSV / XLSX (SheetJS)

**Files:**
- Modify: `packages/web/package.json` (add `xlsx`)
- Create: `packages/web/lib/merge-xlsx.ts`
- Test: `packages/web/lib/merge-xlsx.test.ts`

**Interfaces:**
- Consumes: `Rows` type from `@event-editor/core/merge`.
- Produces: `parseWorkbook(buf: ArrayBuffer): Rows` — reads the first sheet, first row = headers, later rows = records keyed by header. Empty trailing cells become `""`.

- [ ] **Step 1: Add the dependency**

Run: `npm i xlsx -w @event-editor/web`
Confirm license (Apache-2.0): `npm view xlsx license`
Expected: `Apache-2.0`.

- [ ] **Step 2: Write the failing test**

```ts
// packages/web/lib/merge-xlsx.test.ts
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "./merge-xlsx";

function csvBuffer(csv: string): ArrayBuffer {
  const wb = XLSX.read(csv, { type: "string" });
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out as ArrayBuffer;
}

describe("parseWorkbook", () => {
  it("reads headers and rows from the first sheet", () => {
    const buf = csvBuffer("Name,Org\nAda,Analytical\nGrace,Navy");
    const out = parseWorkbook(buf);
    expect(out.headers).toEqual(["Name", "Org"]);
    expect(out.rows).toEqual([
      { Name: "Ada", Org: "Analytical" },
      { Name: "Grace", Org: "Navy" },
    ]);
  });
  it("fills missing cells with empty strings", () => {
    const buf = csvBuffer("Name,Org\nAda");
    const out = parseWorkbook(buf);
    expect(out.rows[0]).toEqual({ Name: "Ada", Org: "" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @event-editor/web -- merge-xlsx`
Expected: FAIL — `parseWorkbook` not defined.

- [ ] **Step 4: Write minimal implementation**

```ts
// packages/web/lib/merge-xlsx.ts
import * as XLSX from "xlsx";
import type { Rows } from "@event-editor/core/merge";

export function parseWorkbook(buf: ArrayBuffer): Rows {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  // header:1 -> array of arrays; defval "" keeps empty cells.
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false });
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => String(h).trim());
  const rows = grid.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => {
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = String(r[i] ?? "").trim(); });
      return row;
    });
  return { headers, rows };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @event-editor/web -- merge-xlsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/package-lock.json packages/web/lib/merge-xlsx.ts packages/web/lib/merge-xlsx.test.ts
git commit -m "feat(merge): parse uploaded CSV/XLSX with SheetJS"
```

---

### Task 7: Web — render a DocumentSpec to PDF (combined + zip)

**Files:**
- Modify: `packages/web/package.json` (add `@pdf-lib/fontkit`)
- Add: `packages/web/public/fonts/heading.ttf`, `packages/web/public/fonts/body.ttf` (two OFL Google fonts, e.g. Fraunces + Inter)
- Create: `packages/web/lib/merge-render.ts`
- Test: `packages/web/lib/merge-render.test.ts`

**Interfaces:**
- Consumes: `DocumentSpec`, `Element`, `resolveText` from `@event-editor/core/merge`; `safeBase` from `@event-editor/core/names`.
- Produces:
  ```ts
  export interface FontBytes { heading?: Uint8Array; body?: Uint8Array }
  export async function renderCombined(spec: DocumentSpec, rows: Record<string,string>[], fonts?: FontBytes): Promise<Uint8Array>
  export async function renderZip(spec: DocumentSpec, rows: Record<string,string>[], nameField: string, fonts?: FontBytes): Promise<Blob>
  export async function loadBundledFonts(): Promise<FontBytes> // fetches /fonts/*.ttf in the browser
  ```
  When `fonts.heading`/`body` are absent, fall back to pdf-lib `StandardFonts.Helvetica`/`HelveticaBold` so rendering never fails (and tests need no TTF). One page per row; page size from `spec.page`; text anchored per `align` using measured width.

- [ ] **Step 1: Add the dependency**

Run: `npm i @pdf-lib/fontkit -w @event-editor/web`
Confirm license (MIT): `npm view @pdf-lib/fontkit license`
Expected: `MIT`.

- [ ] **Step 2: Write the failing test**

```ts
// packages/web/lib/merge-render.test.ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { renderCombined, renderZip } from "./merge-render";
import type { DocumentSpec } from "@event-editor/core/merge";

const spec: DocumentSpec = {
  page: { width: 841.89, height: 595.28 },
  elements: [
    { kind: "text", template: "To {Name}", x: 420, y: 300, size: 40, font: "heading", align: "center", color: "#111111" },
  ],
};
const rows = [{ Name: "Ada" }, { Name: "Grace" }, { Name: "Katherine" }];

describe("renderCombined", () => {
  it("produces one page per row at the spec's page size", async () => {
    const bytes = await renderCombined(spec, rows);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    const p = doc.getPage(0);
    expect(p.getWidth()).toBeCloseTo(841.89, 0);
    expect(p.getHeight()).toBeCloseTo(595.28, 0);
  });
  it("returns a valid empty-safe PDF for zero rows", async () => {
    const bytes = await renderCombined(spec, []);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(0);
  });
});

describe("renderZip", () => {
  it("creates one named PDF per row", async () => {
    const blob = await renderZip(spec, rows, "Name");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(["Ada.pdf", "Grace.pdf", "Katherine.pdf"]);
  });
  it("disambiguates duplicate names", async () => {
    const dup = [{ Name: "Ada" }, { Name: "Ada" }];
    const blob = await renderZip(spec, dup, "Name");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["Ada-2.pdf", "Ada.pdf"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @event-editor/web -- merge-render`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// packages/web/lib/merge-render.ts
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import JSZip from "jszip";
import { resolveText, type DocumentSpec } from "@event-editor/core/merge";
import { safeBase } from "@event-editor/core/names";

export interface FontBytes { heading?: Uint8Array; body?: Uint8Array }

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x111111;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function embedFonts(doc: PDFDocument, fonts?: FontBytes) {
  doc.registerFontkit(fontkit);
  const heading: PDFFont = fonts?.heading
    ? await doc.embedFont(fonts.heading)
    : await doc.embedFont(StandardFonts.HelveticaBold);
  const body: PDFFont = fonts?.body
    ? await doc.embedFont(fonts.body)
    : await doc.embedFont(StandardFonts.Helvetica);
  return { heading, body };
}

function drawPage(
  page: import("pdf-lib").PDFPage,
  spec: DocumentSpec,
  row: Record<string, string>,
  f: { heading: PDFFont; body: PDFFont },
) {
  for (const el of spec.elements) {
    if (el.kind !== "text") continue; // image elements land in F3
    const str = resolveText(el.template, row);
    if (!str) continue;
    const font = el.font === "heading" ? f.heading : f.body;
    const w = font.widthOfTextAtSize(str, el.size);
    const x = el.align === "center" ? el.x - w / 2 : el.align === "right" ? el.x - w : el.x;
    page.drawText(str, { x, y: el.y, size: el.size, font, color: hexToRgb(el.color) });
  }
}

export async function renderCombined(
  spec: DocumentSpec,
  rows: Record<string, string>[],
  fonts?: FontBytes,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, fonts);
  for (const row of rows) {
    const page = doc.addPage([spec.page.width, spec.page.height]);
    drawPage(page, spec, row, f);
  }
  return doc.save();
}

async function renderOne(
  spec: DocumentSpec,
  row: Record<string, string>,
  fonts?: FontBytes,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, fonts);
  const page = doc.addPage([spec.page.width, spec.page.height]);
  drawPage(page, spec, row, f);
  return doc.save();
}

export async function renderZip(
  spec: DocumentSpec,
  rows: Record<string, string>[],
  nameField: string,
  fonts?: FontBytes,
): Promise<Blob> {
  const zip = new JSZip();
  const used = new Map<string, number>();
  for (const row of rows) {
    const base = safeBase(row[nameField] ?? "") || "certificate";
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const name = n === 1 ? `${base}.pdf` : `${base}-${n}.pdf`;
    zip.file(name, await renderOne(spec, row, fonts));
  }
  return zip.generateAsync({ type: "blob" });
}

export async function loadBundledFonts(): Promise<FontBytes> {
  const get = async (p: string) => new Uint8Array(await (await fetch(p)).arrayBuffer());
  const [heading, body] = await Promise.all([
    get("/fonts/heading.ttf"),
    get("/fonts/body.ttf"),
  ]);
  return { heading, body };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @event-editor/web -- merge-render`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/package-lock.json packages/web/lib/merge-render.ts packages/web/lib/merge-render.test.ts packages/web/public/fonts
git commit -m "feat(merge): render DocumentSpec to combined PDF and zip"
```

---

### Task 8: Web — Google Sheet URL parser + fetch route

**Files:**
- Create: `packages/web/lib/sheet-url.ts`
- Test: `packages/web/lib/sheet-url.test.ts`
- Create: `packages/web/app/api/sheet/route.ts`

**Interfaces:**
- Consumes: `Rows` type; the existing reader in `packages/web/lib/google/sheets.ts` (inspect its exported function before writing the route — reuse it rather than calling googleapis directly).
- Produces:
  - `parseSheetUrl(url: string): { id: string; gid: string | null } | null` — extracts the spreadsheet id and optional `gid` from a share/edit URL; returns `null` if not a Google Sheets URL.
  - `POST /api/sheet` accepting `{ url: string }`, returning `{ headers, rows }` (same shape as `parseWorkbook`) or `{ error }` with an appropriate status.

- [ ] **Step 1: Write the failing test for the URL parser**

```ts
// packages/web/lib/sheet-url.test.ts
import { describe, it, expect } from "vitest";
import { parseSheetUrl } from "./sheet-url";

describe("parseSheetUrl", () => {
  it("extracts id and gid from an edit URL", () => {
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=42"))
      .toEqual({ id: "ABC123", gid: "42" });
  });
  it("extracts id with no gid", () => {
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/ABC123/edit"))
      .toEqual({ id: "ABC123", gid: null });
  });
  it("reads gid from a query param", () => {
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/XYZ/edit?gid=7#gid=7"))
      .toEqual({ id: "XYZ", gid: "7" });
  });
  it("returns null for a non-sheets url", () => {
    expect(parseSheetUrl("https://example.com/x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @event-editor/web -- sheet-url`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

```ts
// packages/web/lib/sheet-url.ts
export function parseSheetUrl(url: string): { id: string; gid: string | null } | null {
  const idMatch = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url);
  if (!idMatch) return null;
  const gidMatch = /[#?&]gid=([0-9]+)/.exec(url);
  return { id: idMatch[1], gid: gidMatch ? gidMatch[1] : null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @event-editor/web -- sheet-url`
Expected: PASS.

- [ ] **Step 5: Inspect the existing Sheets reader**

Run: `sed -n '1,60p' packages/web/lib/google/sheets.ts`
Note the exported read function's name and signature; use it in the next step instead of calling `googleapis` directly. (If it reads by range, request the whole first sheet, e.g. `A:ZZ`, and take the first row as headers.)

- [ ] **Step 6: Implement the route**

```ts
// packages/web/app/api/sheet/route.ts
import { NextResponse } from "next/server";
import { parseSheetUrl } from "@/lib/sheet-url";
// import { <readFn> } from "@/lib/google/sheets"; // use the real export from Step 5

export async function POST(req: Request) {
  let body: { url?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const parsed = body.url ? parseSheetUrl(body.url) : null;
  if (!parsed) return NextResponse.json({ error: "That does not look like a Google Sheet link." }, { status: 400 });

  try {
    // Replace with the reader from Step 5. Expected to return a 2-D grid of strings.
    const grid = await readSheetGrid(parsed.id, parsed.gid); // -> string[][]
    if (!grid || grid.length === 0) return NextResponse.json({ headers: [], rows: [] });
    const headers = grid[0].map((h) => String(h).trim());
    const rows = grid.slice(1)
      .filter((r) => r.some((c) => String(c).trim() !== ""))
      .map((r) => {
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = String(r[i] ?? "").trim(); });
        return row;
      });
    return NextResponse.json({ headers, rows });
  } catch (e) {
    const msg = e instanceof Error && /permission|403|not.*shared/i.test(e.message)
      ? "That sheet is not shared with this app. Share it or make it viewable by anyone with the link."
      : "Could not read that sheet. Check the link and try again.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
```

> Wire `readSheetGrid` to the real reader identified in Step 5. Grid normalization here mirrors `parseWorkbook` (Task 6) intentionally — same input shape, same output shape.

- [ ] **Step 7: Confirm the web test suite is green**

Run: `npm test -w @event-editor/web -- sheet-url`
Expected: PASS. (Route is exercised manually in Task 10.)

- [ ] **Step 8: Commit**

```bash
git add packages/web/lib/sheet-url.ts packages/web/lib/sheet-url.test.ts packages/web/app/api/sheet/route.ts
git commit -m "feat(merge): google sheet url parser and fetch route"
```

---

### Task 9: Web — certificate tool UI

**Files:**
- Create: `packages/web/app/certificate/page.tsx`
- Create: `packages/web/app/certificate/CertificateClient.tsx`

**Interfaces:**
- Consumes: `parseWorkbook` (Task 6), `renderCombined`/`renderZip`/`loadBundledFonts` (Task 7), `parseDelimited`/`autoMatchColumns`/`deriveFields` (`@event-editor/core/merge`), `certificateSpec`/`CERTIFICATE_LAYOUTS` (`@event-editor/core/certificate`), `Segmented`, `FileDrop`. Reads Sheet rows by POSTing to `/api/sheet`.
- Produces: the `/certificate` route. No new exported logic — this task wires existing units.

- [ ] **Step 1: Page shell (server component)**

Mirror `packages/web/app/qr/page.tsx` (open it first for the exact heading/description markup and container classes), swapping copy:

```tsx
// packages/web/app/certificate/page.tsx
import { CertificateClient } from "./CertificateClient";

export const metadata = { title: "Make certificates" };

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Make certificates</h1>
      <p className="mt-2 text-muted">
        Turn a list of names into personalised certificates. Nothing leaves your browser.
      </p>
      <CertificateClient />
    </main>
  );
}
```

- [ ] **Step 2: Client component — state + list input**

Build `CertificateClient.tsx` as a `"use client"` component. Three list sources via `Segmented` (`paste` | `upload` | `sheet`), each producing a `Rows` value into one `rows` state:
- paste → `parseDelimited(textarea)`
- upload → `FileDrop` accepting `.csv,.xlsx`; on file, `parseWorkbook(await file.arrayBuffer())`
- sheet → input + button → `fetch("/api/sheet", { method:"POST", body: JSON.stringify({url}) })`; on `res.ok` set rows, else show `data.error` in `text-danger`.

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { FileDrop } from "@/components/FileDrop";
import {
  parseDelimited, autoMatchColumns, deriveFields, type Rows,
} from "@event-editor/core/merge";
import { certificateSpec, CERTIFICATE_LAYOUTS, type CertificateLayout } from "@event-editor/core/certificate";
import { parseWorkbook } from "@/lib/merge-xlsx";
import { renderCombined, renderZip, loadBundledFonts, type FontBytes } from "@/lib/merge-render";

type Source = "paste" | "upload" | "sheet";

export function CertificateClient() {
  const [source, setSource] = useState<Source>("paste");
  const [rows, setRows] = useState<Rows>({ headers: [], rows: [] });
  const [pasteText, setPasteText] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [layout, setLayout] = useState<CertificateLayout>("classic");
  const [title, setTitle] = useState("Certificate of Completion");
  const [bodyLine, setBodyLine] = useState("This certifies that");
  const [detailLine, setDetailLine] = useState("has completed the workshop");
  const [dateText, setDateText] = useState("");
  const [signatureName, setSignatureName] = useState("SPARK");
  const [recipientField, setRecipientField] = useState("Name");

  // keep pasted rows live
  useEffect(() => {
    if (source === "paste") setRows(parseDelimited(pasteText));
  }, [source, pasteText]);

  const spec = useMemo(() => certificateSpec({
    layout, title, bodyLine, recipientField, detailLine, dateText,
    signatureName: signatureName || undefined,
  }), [layout, title, bodyLine, recipientField, detailLine, dateText, signatureName]);

  const fields = useMemo(() => deriveFields(spec), [spec]);
  const mapping = useMemo(() => autoMatchColumns(fields, rows.headers), [fields, rows.headers]);
  const recipientColumn = mapping[recipientField] ?? recipientField;

  // remap headers so the spec's {recipientField} token resolves against the picked column
  const mergedRows = useMemo(
    () => rows.rows.map((r) => ({ ...r, [recipientField]: r[recipientColumn] ?? r[recipientField] ?? "" })),
    [rows.rows, recipientField, recipientColumn],
  );

  async function download(kind: "combined" | "zip") {
    setBusy(true); setError(null);
    try {
      let fonts: FontBytes | undefined;
      try { fonts = await loadBundledFonts(); } catch { fonts = undefined; }
      if (kind === "combined") {
        const bytes = await renderCombined(spec, mergedRows, fonts);
        triggerDownload(new Blob([bytes], { type: "application/pdf" }), "certificates.pdf");
      } else {
        const blob = await renderZip(spec, mergedRows, recipientField, fonts);
        triggerDownload(blob, "certificates.zip");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function onUpload(file: File) {
    setError(null);
    try { setRows(parseWorkbook(await file.arrayBuffer())); }
    catch { setError("Could not read that file. Use a .csv or .xlsx export."); }
  }

  async function loadSheet() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/sheet", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sheetUrl }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not load that sheet."); return; }
      setRows(data);
    } catch { setError("Could not load that sheet."); }
    finally { setBusy(false); }
  }

  const count = mergedRows.length;
  const ready = count > 0 && !!recipientColumn;

  return (
    <div className="mt-8 space-y-5">
      {/* 1. list source */}
      <div className="card">
        <p className="text-sm font-medium">Attendee list</p>
        <div className="mt-2">
          <Segmented
            options={[
              { value: "paste", label: "Paste" },
              { value: "upload", label: "Upload CSV" },
              { value: "sheet", label: "Google Sheet" },
            ]}
            value={source}
            onChange={(v) => setSource(v as Source)}
          />
        </div>
        {source === "paste" && (
          <textarea
            className="field mt-3 h-32 w-full"
            placeholder={"One name per line, or paste columns from a spreadsheet"}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
        )}
        {source === "upload" && (
          <div className="mt-3">
            <FileDrop accept=".csv,.xlsx" onFile={onUpload} />
          </div>
        )}
        {source === "sheet" && (
          <div className="mt-3 flex gap-2">
            <input className="field flex-1" placeholder="Paste a Google Sheet link"
              value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
            <button className="btn" onClick={loadSheet} disabled={busy || !sheetUrl}>Load</button>
          </div>
        )}
        <p className="mt-2 text-sm text-muted">{count} {count === 1 ? "row" : "rows"} loaded</p>
      </div>

      {/* 2. layout + copy */}
      <div className="card space-y-3">
        <p className="text-sm font-medium">Design</p>
        <Segmented
          options={CERTIFICATE_LAYOUTS.map((l) => ({ value: l.id, label: l.label }))}
          value={layout}
          onChange={(v) => setLayout(v as CertificateLayout)}
        />
        <LabeledInput label="Title" value={title} onChange={setTitle} />
        <LabeledInput label="Body line" value={bodyLine} onChange={setBodyLine} />
        <LabeledInput label="Detail line" value={detailLine} onChange={setDetailLine} />
        <LabeledInput label="Date" value={dateText} onChange={setDateText} />
        <LabeledInput label="Signature" value={signatureName} onChange={setSignatureName} />
        <LabeledInput label="Recipient column" value={recipientField} onChange={setRecipientField} />
        {rows.headers.length > 0 && !rows.headers.includes(recipientColumn) && (
          <p className="text-sm text-amber-600">
            No “{recipientField}” column found. Available: {rows.headers.join(", ")}.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* 3. output */}
      <div className="card flex flex-wrap gap-3">
        <button className="btn btn-accent inline-flex items-center gap-2"
          onClick={() => download("combined")} disabled={!ready || busy}>
          <Download className="w-4 h-4" strokeWidth={1.75} /> Combined PDF
        </button>
        <button className="btn inline-flex items-center gap-2"
          onClick={() => download("zip")} disabled={!ready || busy}>
          <Download className="w-4 h-4" strokeWidth={1.75} /> Zip of files
        </button>
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium">{label}
      <input className="field mt-1 w-full" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

> Before writing, open `packages/web/components/FileDrop.tsx` and `Segmented.tsx` to confirm their real prop names (`onFile` vs `onFiles`, `accept` support). Adjust the calls above to match — do not invent props.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run build -w @event-editor/web` (or the repo's typecheck script)
Expected: compiles; no missing-prop or type errors. Fix any prop mismatches flagged against `FileDrop`/`Segmented`.

- [ ] **Step 4: Manual smoke (dev server)**

Run the app; visit `/certificate`. Paste three names, pick each layout, download the combined PDF and the zip. Confirm: names centered and correct, three pages / three files, filenames match names. Note: per the batch-E lesson, this human round-trip is owed and not covered by unit tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/certificate
git commit -m "feat(certificate): certificate generator UI"
```

---

### Task 10: Register the certificate tool in the discovery shell

**Files:**
- Modify: `packages/web/components/tools.ts`

**Interfaces:**
- Consumes: the `Tool` shape and `TOOLS` array already in the file.
- Produces: a `certificate` entry in `TOOLS`, in the existing `events` group.

- [ ] **Step 1: Add the import and entry**

Add `Award` to the `lucide-react` import, then append to `TOOLS`:

```ts
  {
    id: "certificate",
    href: "/certificate",
    title: "Make certificates",
    body: "Turn a list of names into personalised, print-ready certificates.",
    Icon: Award,
    defaultGroups: ["events", "documents"],
    tags: ["certificate", "award", "merge", "names", "event", "pdf"],
  },
```

- [ ] **Step 2: Verify the existing-install group merge**

The `events` and `documents` groups already exist in `DEFAULT_GROUP_ORDER`, so no new group is introduced (contrast the batch-B utilities-group bug). Confirm by reading `packages/web/components/tool-store.ts` that `events` and `documents` are present in the default group order, so a returning user with persisted `ee.toolShell` still sees the new card under an existing group.

Run: `grep -n "events\|documents" packages/web/components/tool-store.ts`
Expected: both group ids present in the default order.

- [ ] **Step 3: Typecheck**

Run: `npm run build -w @event-editor/web`
Expected: compiles; the card appears under Events on the home shell.

- [ ] **Step 4: Commit**

```bash
git add packages/web/components/tools.ts
git commit -m "feat(certificate): register tool in the discovery shell"
```

---

## Self-Review (F1)

- **Spec coverage:** merge core (Tasks 1-3, 5), client rendering + both outputs (Task 7), all three data sources (paste T2, CSV/XLSX T6, Sheet T8), certificate built-in layouts (Task 4), UI (Task 9), shell registration (Task 10), PII-stays-local (rendering all client-side; only `/api/sheet` server-side). Custom-background path and N-up are F3/F2 by design.
- **Types:** `Rows`, `DocumentSpec`, `TextElement`, `FontBytes`, `CertificateOptions` defined once (Tasks 1, 4, 7) and consumed by name downstream. `renderCombined`/`renderZip`/`loadBundledFonts` names match between Task 7 and Task 9. `parseWorkbook`, `parseDelimited`, `autoMatchColumns`, `deriveFields`, `certificateSpec`, `CERTIFICATE_LAYOUTS` all match producer↔consumer.
- **Placeholders:** none. The one deliberate wiring note is `readSheetGrid` in Task 8, which Step 5 resolves against the real `lib/google/sheets.ts` export before the route is written.

---

## F2 — badge, place card, ticket (follow-on, outline)

Build after F1 proves the pipeline. Each is the certificate pattern with tool-specific spec builders and two new shared core helpers. Reuse Tasks 1-3, 6, 7, 8 unchanged.

- **New core:** `nUpGrid(page: PageSize, cell: PageSize, gap: number): { x: number; y: number }[]` (tiling positions with crop-guide metadata) + `badge.ts`, `placecard.ts`, `ticket.ts` spec builders. Each has 1-3 built-in layouts. TDD like Task 4.
- **New render helper:** `renderSheet(cellSpec, rows, fonts, perPage)` in `merge-render.ts` — draws N cells per page for the cut-sheet output; `renderCombined`/`renderZip` stay for the one-per-page case. Test asserts page count = ceil(rows / perPage) and cell placement.
- **QR:** badge/ticket specs may include a QR `ImageElement`; generate the PNG data URL with the existing `qrcode` dep at spec-build time from a chosen column (e.g. `{Name}` or a check-in code). Extend `drawPage` to handle `ImageElement` (embed PNG via `doc.embedPng`).
- **Three routes** `/badge`, `/place-card`, `/ticket` + three `tools.ts` entries (`IdCard`, `StickyNote`, `Ticket` icons), all `events` group.
- **Open:** confirm physical dimensions (lanyard stock, ticket strip) during F2 planning.

Estimated: one plan, ~10-12 tasks.

## F3 — upload your own background + field editor (follow-on, outline)

The flexible escape hatch, built last on proven core.

- **Render:** `drawPage` already ignores nothing structural; add full-page `spec.background` support (embed the uploaded PNG/PDF-page as page 1 backdrop) in `merge-render.ts`.
- **Editor:** a client-only mini canvas (`components/FieldCanvas.tsx`) that renders the uploaded background to scale and lets the user drop/drag `{Field}` text elements, editing position/size/font/align/color. Emits a `DocumentSpec` — same type the built-in layouts already produce, so the whole render/output pipeline is reused unchanged.
- **Session-only:** placements live in React state (optionally serialise to `localStorage`); no server template store this batch.
- **Wire** an "upload your own" tab into all four tools alongside the built-in layouts.
- **Open:** PDF-background rasterisation approach (pdf.js vs. accept image only) — decide in F3 planning.

Estimated: one plan, ~8-10 tasks, canvas editor is the bulk.
