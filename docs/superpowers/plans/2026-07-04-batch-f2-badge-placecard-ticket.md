# Batch F2 — badge, place card, ticket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three more event-document generators — `/badge`, `/place-card`, `/ticket` — on the F1 merge engine, adding per-row QR codes and N-up cut-sheet output.

**Architecture:** Extend the shared core `Element` union with a `QrElement` (per-row QR), add a pure `nUpGrid` tiling helper and three spec builders (`badgeSpec`, `placecardSpec`, `ticketSpec`). In web, make the pdf-lib renderer async so it can embed images/QR, add `renderSheet` (N-up), and drive all three tools through one config-driven `MergeToolClient`. No new API routes — rendering stays client-side; the Google Sheet path reuses F1's `/api/sheet`.

**Tech Stack:** TypeScript, pdf-lib + `@pdf-lib/fontkit` + `qrcode` (all existing deps), jszip, vitest, Next.js App Router client components.

## Global Constraints

- **Monorepo:** pure logic → `packages/core/src/*.ts` (vitest, colocated `*.test.ts`), core-internal imports use explicit `.js`. React + heavy libs → `packages/web`. Import core via subpaths (`@event-editor/core/merge` etc.), never deep `dist/` paths.
- **Rebuild core after editing it:** `npm run build -w @event-editor/core` before web/tests see the change.
- **This builds on F1 (already shipped).** Reuse, do not reimplement: `resolveText`, `deriveFields`, `autoMatchColumns`, `parseDelimited` (`merge.ts`); `certificateSpec` pattern (`certificate.ts`); `renderCombined`/`renderZip`/`loadBundledFonts`/`embedFonts`/`drawPage`/`hexToRgb` (`packages/web/lib/merge-render.ts`); `parseWorkbook` (`merge-xlsx.ts`); `rowsFromValues` + `/api/sheet` (`merge-sheet.ts`); the `Tool` registry shape (`components/tools.ts`).
- **Rendering is client-side.** No attendee data leaves the browser except the existing `/api/sheet` fetch.
- **Additive, backward-compatible core changes only.** Existing F1 specs/tests must keep passing. `drawPage` becomes async — update its F1 callers in the same task.
- **web tsc has 5 PRE-EXISTING errors** in `test/canva-oauth.test.ts` / `test/docs.test.ts`. "Clean" = no NEW errors from the task's files.
- **Copy/house rules:** sentence-case labels, no ALL-CAPS eyebrows, no em dashes in UI copy. Warnings `text-amber-600` (NOT `text-warning`); errors `text-danger`; exactly one accent button per view.
- **No new dependencies.** `qrcode` and `@types/qrcode` already present.
- **Commit on `main`, do not branch, do not push** (controller pushes). One commit per task.

---

## Shared geometry constants (used across tasks)

All sizes in PDF points (72 = 1 inch). pdf-lib origin is bottom-left.

```
A4 sheet (portrait): 595.28 × 841.89   gap between cells: 18
badge cell:     288 × 216  (4"   × 3")     → 2 cols × 3 rows = 6-up
place-card cell:288 × 180  (4"   × 2.5")   → 2 cols × 4 rows = 8-up
ticket cell:    396 × 144  (5.5" × 2")     → 1 col  × 5 rows = 5-up
```

---

### Task 1: Core — QrElement + deriveFields covers QR values

**Files:**
- Modify: `packages/core/src/merge.ts`
- Test: `packages/core/src/merge.test.ts`

**Interfaces:**
- Consumes: existing `Element`, `deriveFields`.
- Produces: `QrElement` added to the `Element` union; `deriveFields` also scans `qr` element `value` templates for `{Token}`s. `QrElement = { kind: "qr"; value: string; x: number; y: number; size: number }` (value is a template like `"{Name}"`; size is the square side in points; x,y is the bottom-left corner).

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/core/src/merge.test.ts
import type { QrElement } from "./merge.js";

describe("QrElement + deriveFields", () => {
  it("derives tokens from qr element values", () => {
    const spec: DocumentSpec = {
      page: { width: 100, height: 100 },
      elements: [
        { kind: "text", template: "{Name}", x: 0, y: 0, size: 12, font: "heading", align: "left", color: "#000000" },
        { kind: "qr", value: "{Code}", x: 0, y: 0, size: 40 } as QrElement,
      ],
    };
    expect(deriveFields(spec)).toEqual(["Name", "Code"]);
  });
  it("does not duplicate a token used in both text and qr", () => {
    const spec: DocumentSpec = {
      page: { width: 100, height: 100 },
      elements: [
        { kind: "text", template: "{Name}", x: 0, y: 0, size: 12, font: "body", align: "left", color: "#000000" },
        { kind: "qr", value: "{Name}", x: 0, y: 0, size: 40 } as QrElement,
      ],
    };
    expect(deriveFields(spec)).toEqual(["Name"]);
  });
});
```

- [ ] **Step 2: Run red**

`npm test -w @event-editor/core -- merge` — FAIL (`QrElement` not exported / qr tokens not derived).

- [ ] **Step 3: Implement**

In `merge.ts`, add the type and extend the union:

```ts
export interface QrElement {
  kind: "qr";
  value: string; // template, e.g. "{Name}" or "{Code}"
  x: number; y: number; // bottom-left corner
  size: number; // square side, points
}
export type Element = TextElement | ImageElement | QrElement;
```

Update `deriveFields` to also scan `qr` values (keep the text scan; add qr):

```ts
export function deriveFields(spec: DocumentSpec): string[] {
  const seen: string[] = [];
  const scan = (tpl: string) => {
    for (const m of tpl.matchAll(/\{([^}]+)\}/g)) {
      const f = m[1].trim();
      if (!seen.includes(f)) seen.push(f);
    }
  };
  for (const el of spec.elements) {
    if (el.kind === "text") scan(el.template);
    else if (el.kind === "qr") scan(el.value);
  }
  return seen;
}
```

- [ ] **Step 4: Run green**

`npm test -w @event-editor/core -- merge` — PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/merge.ts packages/core/src/merge.test.ts
git commit -m "feat(merge): QrElement type and QR token derivation"
```

---

### Task 2: Core — nUpGrid tiling helper

**Files:**
- Create: `packages/core/src/nup.ts`
- Test: `packages/core/src/nup.test.ts`

**Interfaces:**
- Consumes: `PageSize` from `./merge.js`.
- Produces:
  ```ts
  export interface Placement { x: number; y: number } // bottom-left of a cell, page coords
  export interface Grid { cols: number; rows: number; placements: Placement[] }
  export function nUpGrid(page: PageSize, cell: PageSize, gap: number): Grid
  ```
  Cells fill left-to-right, top row first; the whole block is centered on the page. At least 1×1.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/nup.test.ts
import { describe, it, expect } from "vitest";
import { nUpGrid } from "./nup.js";

const A4 = { width: 595.28, height: 841.89 };

describe("nUpGrid", () => {
  it("computes a 6-up grid for a 288x216 badge on A4", () => {
    const g = nUpGrid(A4, { width: 288, height: 216 }, 18);
    expect(g.cols).toBe(2);
    expect(g.rows).toBe(3);
    expect(g.placements).toHaveLength(6);
  });
  it("centers the block horizontally", () => {
    const g = nUpGrid(A4, { width: 288, height: 216 }, 18);
    const blockW = 2 * 288 + 18;
    const startX = (595.28 - blockW) / 2;
    expect(g.placements[0].x).toBeCloseTo(startX, 2);
  });
  it("orders top row first (highest y first)", () => {
    const g = nUpGrid(A4, { width: 288, height: 216 }, 18);
    // placement 0 is top-left; its y is above placement 2 (next row)
    expect(g.placements[0].y).toBeGreaterThan(g.placements[2].y);
  });
  it("never returns fewer than one cell", () => {
    const g = nUpGrid({ width: 100, height: 100 }, { width: 999, height: 999 }, 0);
    expect(g.cols).toBe(1);
    expect(g.rows).toBe(1);
    expect(g.placements).toHaveLength(1);
  });
  it("computes 5-up for a 396x144 ticket", () => {
    const g = nUpGrid(A4, { width: 396, height: 144 }, 18);
    expect(g.cols).toBe(1);
    expect(g.rows).toBe(5);
  });
});
```

- [ ] **Step 2: Run red**

`npm test -w @event-editor/core -- nup` — FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/core/src/nup.ts
import type { PageSize } from "./merge.js";

export interface Placement { x: number; y: number }
export interface Grid { cols: number; rows: number; placements: Placement[] }

export function nUpGrid(page: PageSize, cell: PageSize, gap: number): Grid {
  const cols = Math.max(1, Math.floor((page.width + gap) / (cell.width + gap)));
  const rows = Math.max(1, Math.floor((page.height + gap) / (cell.height + gap)));
  const blockW = cols * cell.width + (cols - 1) * gap;
  const blockH = rows * cell.height + (rows - 1) * gap;
  const startX = (page.width - blockW) / 2;
  const startY = (page.height - blockH) / 2;
  const placements: Placement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * (cell.width + gap);
      // top row first: row 0 sits at the top of the block (highest y)
      const y = startY + blockH - (r + 1) * cell.height - r * gap;
      placements.push({ x, y });
    }
  }
  return { cols, rows, placements };
}
```

- [ ] **Step 4: Run green**

`npm test -w @event-editor/core -- nup` — PASS (5).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/nup.ts packages/core/src/nup.test.ts
git commit -m "feat(merge): nUpGrid cut-sheet tiling helper"
```

---

### Task 3: Core — badge spec builder

**Files:**
- Create: `packages/core/src/badge.ts`
- Test: `packages/core/src/badge.test.ts`

**Interfaces:**
- Consumes: `DocumentSpec`, `TextElement`, `QrElement` from `./merge.js`.
- Produces:
  ```ts
  export const BADGE_LAYOUTS: readonly { id: "centered" | "leftQr"; label: string }[]
  export interface BadgeOptions {
    layout: "centered" | "leftQr";
    nameField: string;   // token, default "Name"
    orgField: string;    // token, default "Org"
    eventTitle: string;  // constant, may be ""
    qr: boolean;         // include a QR of {nameField}
  }
  export function badgeSpec(opts: BadgeOptions): DocumentSpec  // cell 288 × 216
  ```
  `centered`: event title small top-center, name large center, org below center; if `qr`, a 44pt QR bottom-center. `leftQr`: name + org left-aligned, a 64pt QR on the right; event title small top-left.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/badge.test.ts
import { describe, it, expect } from "vitest";
import { badgeSpec, BADGE_LAYOUTS } from "./badge.js";
import { deriveFields } from "./merge.js";

const base = { nameField: "Name", orgField: "Org", eventTitle: "SPARK Summit" } as const;

describe("badgeSpec", () => {
  it("is a 4x3in badge cell (288x216)", () => {
    const s = badgeSpec({ ...base, layout: "centered", qr: false });
    expect(s.page).toEqual({ width: 288, height: 216 });
  });
  it("exposes name and org as mergeable fields", () => {
    const s = badgeSpec({ ...base, layout: "centered", qr: false });
    expect(deriveFields(s)).toEqual(["Name", "Org"]);
  });
  it("adds a qr element (of the name) only when qr is true", () => {
    const withQr = badgeSpec({ ...base, layout: "centered", qr: true });
    const without = badgeSpec({ ...base, layout: "centered", qr: false });
    expect(withQr.elements.some((e) => e.kind === "qr")).toBe(true);
    expect(without.elements.some((e) => e.kind === "qr")).toBe(false);
    const qr = withQr.elements.find((e) => e.kind === "qr");
    expect(qr && qr.kind === "qr" && qr.value).toBe("{Name}");
  });
  it("honours custom field names", () => {
    const s = badgeSpec({ ...base, nameField: "Attendee", orgField: "Company", layout: "leftQr", qr: true });
    expect(deriveFields(s)).toEqual(["Attendee", "Company"]);
  });
  it("lists two layouts", () => {
    expect(BADGE_LAYOUTS.map((l) => l.id)).toEqual(["centered", "leftQr"]);
  });
});
```

- [ ] **Step 2: Run red** — `npm test -w @event-editor/core -- badge` — FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/core/src/badge.ts
import type { DocumentSpec, TextElement, QrElement, Align } from "./merge.js";

export const BADGE_LAYOUTS = [
  { id: "centered", label: "Centered" },
  { id: "leftQr", label: "Left with QR" },
] as const;

export type BadgeLayout = (typeof BADGE_LAYOUTS)[number]["id"];

export interface BadgeOptions {
  layout: BadgeLayout;
  nameField: string;
  orgField: string;
  eventTitle: string;
  qr: boolean;
}

const CELL = { width: 288, height: 216 };

function text(template: string, x: number, y: number, size: number, font: "heading" | "body", align: Align, color = "#1a1a1a"): TextElement {
  return { kind: "text", template, x, y, size, font, align, color };
}

export function badgeSpec(opts: BadgeOptions): DocumentSpec {
  const name = `{${opts.nameField || "Name"}}`;
  const org = `{${opts.orgField || "Org"}}`;
  const els: (TextElement | QrElement)[] = [];

  if (opts.layout === "centered") {
    const cx = CELL.width / 2;
    if (opts.eventTitle) els.push(text(opts.eventTitle, cx, 188, 10, "body", "center", "#888888"));
    els.push(text(name, cx, opts.qr ? 128 : 112, 26, "heading", "center"));
    els.push(text(org, cx, opts.qr ? 100 : 84, 13, "body", "center", "#555555"));
    if (opts.qr) els.push({ kind: "qr", value: name, x: cx - 22, y: 14, size: 44 });
  } else {
    // leftQr: text left, QR right
    if (opts.eventTitle) els.push(text(opts.eventTitle, 20, 188, 10, "body", "left", "#888888"));
    els.push(text(name, 20, 120, 24, "heading", "left"));
    els.push(text(org, 20, 96, 13, "body", "left", "#555555"));
    if (opts.qr) els.push({ kind: "qr", value: name, x: 288 - 84, y: 76, size: 64 });
  }

  return { page: { ...CELL }, elements: els };
}
```

- [ ] **Step 4: Run green** — `npm test -w @event-editor/core -- badge` — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/badge.ts packages/core/src/badge.test.ts
git commit -m "feat(badge): badge spec builder with optional QR"
```

---

### Task 4: Core — place-card spec builder

**Files:**
- Create: `packages/core/src/placecard.ts`
- Test: `packages/core/src/placecard.test.ts`

**Interfaces:**
- Consumes: `DocumentSpec`, `TextElement` from `./merge.js`.
- Produces:
  ```ts
  export const PLACECARD_LAYOUTS: readonly { id: "classic" | "withTable"; label: string }[]
  export interface PlaceCardOptions {
    layout: "classic" | "withTable";
    nameField: string;   // default "Name"
    tableField: string;  // default "Table", only used by withTable
  }
  export function placecardSpec(opts: PlaceCardOptions): DocumentSpec  // flat card 288 × 180
  ```
  `classic`: name centered. `withTable`: name centered plus a smaller "Table {tableField}" line below. (Flat card; folded-tent is a documented follow-up.)

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/placecard.test.ts
import { describe, it, expect } from "vitest";
import { placecardSpec, PLACECARD_LAYOUTS } from "./placecard.js";
import { deriveFields } from "./merge.js";

describe("placecardSpec", () => {
  it("is a flat 4x2.5in card (288x180)", () => {
    const s = placecardSpec({ layout: "classic", nameField: "Name", tableField: "Table" });
    expect(s.page).toEqual({ width: 288, height: 180 });
  });
  it("classic exposes only the name field", () => {
    const s = placecardSpec({ layout: "classic", nameField: "Name", tableField: "Table" });
    expect(deriveFields(s)).toEqual(["Name"]);
  });
  it("withTable exposes name and table fields", () => {
    const s = placecardSpec({ layout: "withTable", nameField: "Name", tableField: "Table" });
    expect(deriveFields(s)).toEqual(["Name", "Table"]);
  });
  it("centers the name", () => {
    const s = placecardSpec({ layout: "classic", nameField: "Name", tableField: "Table" });
    const nameEl = s.elements.find((e) => e.kind === "text" && e.template.includes("{Name}"));
    expect(nameEl && nameEl.kind === "text" && nameEl.align).toBe("center");
  });
  it("lists two layouts", () => {
    expect(PLACECARD_LAYOUTS.map((l) => l.id)).toEqual(["classic", "withTable"]);
  });
});
```

- [ ] **Step 2: Run red** — `npm test -w @event-editor/core -- placecard` — FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/placecard.ts
import type { DocumentSpec, TextElement } from "./merge.js";

export const PLACECARD_LAYOUTS = [
  { id: "classic", label: "Classic" },
  { id: "withTable", label: "With table" },
] as const;

export type PlaceCardLayout = (typeof PLACECARD_LAYOUTS)[number]["id"];

export interface PlaceCardOptions {
  layout: PlaceCardLayout;
  nameField: string;
  tableField: string;
}

const CELL = { width: 288, height: 180 };
const CX = CELL.width / 2;

export function placecardSpec(opts: PlaceCardOptions): DocumentSpec {
  const name = `{${opts.nameField || "Name"}}`;
  const els: TextElement[] = [];
  if (opts.layout === "withTable") {
    els.push({ kind: "text", template: name, x: CX, y: 96, size: 30, font: "heading", align: "center", color: "#1a1a1a" });
    els.push({ kind: "text", template: `Table {${opts.tableField || "Table"}}`, x: CX, y: 58, size: 14, font: "body", align: "center", color: "#555555" });
  } else {
    els.push({ kind: "text", template: name, x: CX, y: 78, size: 32, font: "heading", align: "center", color: "#1a1a1a" });
  }
  return { page: { ...CELL }, elements: els };
}
```

- [ ] **Step 4: Run green** — `npm test -w @event-editor/core -- placecard` — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/placecard.ts packages/core/src/placecard.test.ts
git commit -m "feat(placecard): flat place-card spec builder"
```

---

### Task 5: Core — ticket spec builder

**Files:**
- Create: `packages/core/src/ticket.ts`
- Test: `packages/core/src/ticket.test.ts`

**Interfaces:**
- Consumes: `DocumentSpec`, `TextElement`, `QrElement` from `./merge.js`.
- Produces:
  ```ts
  export const TICKET_LAYOUTS: readonly { id: "classic" | "minimal"; label: string }[]
  export interface TicketOptions {
    layout: "classic" | "minimal";
    eventTitle: string;   // constant
    nameField: string;    // default "Name"
    codeField: string;    // token the QR encodes, default = nameField
    qr: boolean;
  }
  export function ticketSpec(opts: TicketOptions): DocumentSpec  // cell 396 × 144
  ```
  `classic`: event title + name on the left, a 110pt QR on the right (when `qr`). `minimal`: name centered, smaller event title above; QR bottom-right (when `qr`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/ticket.test.ts
import { describe, it, expect } from "vitest";
import { ticketSpec, TICKET_LAYOUTS } from "./ticket.js";
import { deriveFields } from "./merge.js";

const base = { eventTitle: "SPARK Summit", nameField: "Name", codeField: "Code" } as const;

describe("ticketSpec", () => {
  it("is a 5.5x2in ticket cell (396x144)", () => {
    const s = ticketSpec({ ...base, layout: "classic", qr: true });
    expect(s.page).toEqual({ width: 396, height: 144 });
  });
  it("encodes the code field in the QR", () => {
    const s = ticketSpec({ ...base, layout: "classic", qr: true });
    const qr = s.elements.find((e) => e.kind === "qr");
    expect(qr && qr.kind === "qr" && qr.value).toBe("{Code}");
  });
  it("falls back to the name field for the QR when codeField is empty", () => {
    const s = ticketSpec({ ...base, codeField: "", layout: "classic", qr: true });
    const qr = s.elements.find((e) => e.kind === "qr");
    expect(qr && qr.kind === "qr" && qr.value).toBe("{Name}");
  });
  it("omits the QR when qr is false", () => {
    const s = ticketSpec({ ...base, layout: "classic", qr: false });
    expect(s.elements.some((e) => e.kind === "qr")).toBe(false);
  });
  it("exposes name (and code when the qr uses it) as fields", () => {
    const s = ticketSpec({ ...base, layout: "classic", qr: true });
    expect(deriveFields(s)).toContain("Name");
    expect(deriveFields(s)).toContain("Code");
  });
  it("lists two layouts", () => {
    expect(TICKET_LAYOUTS.map((l) => l.id)).toEqual(["classic", "minimal"]);
  });
});
```

- [ ] **Step 2: Run red** — `npm test -w @event-editor/core -- ticket` — FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/ticket.ts
import type { DocumentSpec, TextElement, QrElement, Align } from "./merge.js";

export const TICKET_LAYOUTS = [
  { id: "classic", label: "Classic" },
  { id: "minimal", label: "Minimal" },
] as const;

export type TicketLayout = (typeof TICKET_LAYOUTS)[number]["id"];

export interface TicketOptions {
  layout: TicketLayout;
  eventTitle: string;
  nameField: string;
  codeField: string;
  qr: boolean;
}

const CELL = { width: 396, height: 144 };

function text(template: string, x: number, y: number, size: number, font: "heading" | "body", align: Align, color = "#1a1a1a"): TextElement {
  return { kind: "text", template, x, y, size, font, align, color };
}

export function ticketSpec(opts: TicketOptions): DocumentSpec {
  const name = `{${opts.nameField || "Name"}}`;
  const code = `{${opts.codeField || opts.nameField || "Name"}}`;
  const els: (TextElement | QrElement)[] = [];

  if (opts.layout === "classic") {
    if (opts.eventTitle) els.push(text(opts.eventTitle, 24, 104, 14, "heading", "left", "#2563eb"));
    els.push(text(name, 24, 60, 22, "heading", "left"));
    els.push(text("Admit one", 24, 34, 10, "body", "left", "#888888"));
    if (opts.qr) els.push({ kind: "qr", value: code, x: 396 - 128, y: 17, size: 110 });
  } else {
    const cx = opts.qr ? 176 : CELL.width / 2;
    if (opts.eventTitle) els.push(text(opts.eventTitle, cx, 100, 11, "body", "center", "#888888"));
    els.push(text(name, cx, 60, 22, "heading", "center"));
    if (opts.qr) els.push({ kind: "qr", value: code, x: 396 - 96, y: 40, size: 64 });
  }

  return { page: { ...CELL }, elements: els };
}
```

- [ ] **Step 4: Run green** — `npm test -w @event-editor/core -- ticket` — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ticket.ts packages/core/src/ticket.test.ts
git commit -m "feat(ticket): ticket spec builder with QR"
```

---

### Task 6: Core — export new modules + rebuild

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json`

**Interfaces:**
- Produces: subpaths `@event-editor/core/nup`, `/badge`, `/placecard`, `/ticket`.

- [ ] **Step 1: Barrel re-exports** — add to `packages/core/src/index.ts` (existing `export * from "./x.js";` style):

```ts
export * from "./nup.js";
export * from "./badge.js";
export * from "./placecard.js";
export * from "./ticket.js";
```

- [ ] **Step 2: Subpath exports** — in `packages/core/package.json` `"exports"`, alongside `"./merge"`/`"./certificate"`:

```json
    "./nup": "./dist/nup.js",
    "./badge": "./dist/badge.js",
    "./placecard": "./dist/placecard.js",
    "./ticket": "./dist/ticket.js"
```

- [ ] **Step 3: Build + confirm dist**

`npm run build -w @event-editor/core && ls packages/core/dist/{nup,badge,placecard,ticket}.js`
Expected: all four listed, no build errors. If tsc reports a duplicate export, STOP and report.

- [ ] **Step 4: Full core suite**

`npm test -w @event-editor/core` — PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/package.json
git commit -m "feat(core): export nup, badge, placecard, ticket modules"
```

---

### Task 7: Web — render QR/image elements; make drawPage async

**Files:**
- Modify: `packages/web/lib/merge-render.ts`
- Test: `packages/web/lib/merge-render.test.ts`

**Interfaces:**
- Consumes: `QrElement`/`ImageElement` from `@event-editor/core/merge`; existing `qrcode` dep.
- Produces: `drawPage` becomes `async` and gains an offset: `async function drawPage(page, spec, row, f, ox = 0, oy = 0)`. It now handles `image` (embed PNG data URL, draw at x,y,width,height) and `qr` (resolve the value template per row, generate a PNG via `qrcode`, embed, draw at x,y,size,size). `renderCombined`/`renderOne` await `drawPage`. Behaviour for text-only specs is unchanged.

- [ ] **Step 1: Write the failing test** (QR renders without throwing; page count preserved)

```ts
// append to packages/web/lib/merge-render.test.ts
import type { DocumentSpec as DS2 } from "@event-editor/core/merge";

describe("renderCombined with a QR element", () => {
  it("renders a page per row and does not throw on qr elements", async () => {
    const spec: DS2 = {
      page: { width: 288, height: 216 },
      elements: [
        { kind: "text", template: "{Name}", x: 144, y: 120, size: 20, font: "heading", align: "center", color: "#111111" },
        { kind: "qr", value: "{Name}", x: 122, y: 20, size: 44 },
      ],
    };
    const bytes = await renderCombined(spec, [{ Name: "Ada" }, { Name: "Grace" }]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });
  it("skips a qr whose resolved value is empty", async () => {
    const spec: DS2 = {
      page: { width: 288, height: 216 },
      elements: [{ kind: "qr", value: "{Code}", x: 122, y: 20, size: 44 }],
    };
    const bytes = await renderCombined(spec, [{ Name: "Ada" }]); // no Code -> empty -> skip
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run red** — `npm test -w @event-editor/web -- merge-render` — FAIL (qr not handled / drawPage sync).

- [ ] **Step 3: Implement**

Rewrite `drawPage` (async, offset, image + qr) and await it in the two callers. Keep `hexToRgb`, `embedFonts`, the text branch, and the align math exactly as they are.

```ts
async function drawPage(
  page: import("pdf-lib").PDFPage,
  spec: DocumentSpec,
  row: Record<string, string>,
  f: { heading: PDFFont; body: PDFFont },
  ox = 0,
  oy = 0,
) {
  const doc = page.doc;
  for (const el of spec.elements) {
    if (el.kind === "text") {
      const str = resolveText(el.template, row);
      if (!str) continue;
      const font = el.font === "heading" ? f.heading : f.body;
      const w = font.widthOfTextAtSize(str, el.size);
      const x = el.align === "center" ? el.x - w / 2 : el.align === "right" ? el.x - w : el.x;
      page.drawText(str, { x: ox + x, y: oy + el.y, size: el.size, font, color: hexToRgb(el.color) });
    } else if (el.kind === "image") {
      const png = await doc.embedPng(el.src);
      page.drawImage(png, { x: ox + el.x, y: oy + el.y, width: el.width, height: el.height });
    } else if (el.kind === "qr") {
      const str = resolveText(el.value, row);
      if (!str) continue;
      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(str, { width: Math.round(el.size * 3), margin: 0 });
      const png = await doc.embedPng(dataUrl);
      page.drawImage(png, { x: ox + el.x, y: oy + el.y, width: el.size, height: el.size });
    }
  }
}
```

Add `PDFFont` to the existing pdf-lib import if not already imported (it is). Update the callers — in `renderCombined`:

```ts
  for (const row of rows) {
    const page = doc.addPage([spec.page.width, spec.page.height]);
    await drawPage(page, spec, row, f);
  }
```

and in `renderOne`:

```ts
  const page = doc.addPage([spec.page.width, spec.page.height]);
  await drawPage(page, spec, row, f);
```

- [ ] **Step 4: Run green** — `npm test -w @event-editor/web -- merge-render` — PASS (existing 4 + 2 new). Run `npx tsc --noEmit` in packages/web; no new errors from merge-render.ts.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/merge-render.ts packages/web/lib/merge-render.test.ts
git commit -m "feat(merge): render image and per-row QR elements"
```

---

### Task 8: Web — renderSheet (N-up cut sheet)

**Files:**
- Modify: `packages/web/lib/merge-render.ts`
- Test: `packages/web/lib/merge-render.test.ts`

**Interfaces:**
- Consumes: `nUpGrid` from `@event-editor/core/nup`; `drawPage`, `embedFonts` (same module).
- Produces:
  ```ts
  export interface SheetOptions { sheet?: PageSize; gap?: number; cropMarks?: boolean }
  export async function renderSheet(cellSpec: DocumentSpec, rows: Record<string,string>[], fonts?: FontBytes, opts?: SheetOptions): Promise<Uint8Array>
  ```
  Tiles `cellSpec` cells onto A4-portrait sheets (default `{595.28, 841.89}`, gap 18), `nUpGrid` per-page count, top-row-first. Optional light crop marks (thin gray corner ticks) around each cell. Page count = `ceil(rows.length / perPage)`.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/web/lib/merge-render.test.ts
import { renderSheet } from "./merge-render";

const badgeCell: DS2 = {
  page: { width: 288, height: 216 },
  elements: [{ kind: "text", template: "{Name}", x: 144, y: 120, size: 18, font: "heading", align: "center", color: "#111" }],
};

describe("renderSheet", () => {
  it("puts 6 badges per A4 page (ceil(rows/6) pages)", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ Name: `P${i}` }));
    const bytes = await renderSheet(badgeCell, rows);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2); // 7 badges -> 6 + 1
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
  });
  it("returns a 0-page pdf for no rows", async () => {
    const bytes = await renderSheet(badgeCell, []);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run red** — `npm test -w @event-editor/web -- merge-render` — FAIL (renderSheet missing).

- [ ] **Step 3: Implement**

```ts
// add imports at top of merge-render.ts
import { nUpGrid } from "@event-editor/core/nup";
import type { PageSize } from "@event-editor/core/merge";

const SHEET_A4: PageSize = { width: 595.28, height: 841.89 };

export interface SheetOptions { sheet?: PageSize; gap?: number; cropMarks?: boolean }

function drawCropMarks(page: import("pdf-lib").PDFPage, x: number, y: number, cell: PageSize) {
  const t = 6; // tick length
  const g = rgb(0.7, 0.7, 0.7);
  const corners: [number, number][] = [
    [x, y], [x + cell.width, y], [x, y + cell.height], [x + cell.width, y + cell.height],
  ];
  for (const [cx, cy] of corners) {
    page.drawLine({ start: { x: cx - t, y: cy }, end: { x: cx + t, y: cy }, thickness: 0.4, color: g });
    page.drawLine({ start: { x: cx, y: cy - t }, end: { x: cx, y: cy + t }, thickness: 0.4, color: g });
  }
}

export async function renderSheet(
  cellSpec: DocumentSpec,
  rows: Record<string, string>[],
  fonts?: FontBytes,
  opts?: SheetOptions,
): Promise<Uint8Array> {
  const sheet = opts?.sheet ?? SHEET_A4;
  const gap = opts?.gap ?? 18;
  const cropMarks = opts?.cropMarks ?? true;
  const { placements } = nUpGrid(sheet, cellSpec.page, gap);
  const perPage = placements.length;

  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, fonts);
  for (let i = 0; i < rows.length; i += perPage) {
    const page = doc.addPage([sheet.width, sheet.height]);
    const slice = rows.slice(i, i + perPage);
    for (let j = 0; j < slice.length; j++) {
      const { x, y } = placements[j];
      if (cropMarks) drawCropMarks(page, x, y, cellSpec.page);
      await drawPage(page, cellSpec, slice[j], f, x, y);
    }
  }
  return doc.save({ addDefaultPage: false });
}
```

- [ ] **Step 4: Run green** — `npm test -w @event-editor/web -- merge-render` — PASS. `npx tsc --noEmit` in packages/web: no new errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/merge-render.ts packages/web/lib/merge-render.test.ts
git commit -m "feat(merge): renderSheet N-up cut sheet with crop marks"
```

---

### Task 9: Web — shared MergeToolClient + list input + download helpers

**Files:**
- Create: `packages/web/components/AttendeeListInput.tsx`
- Create: `packages/web/lib/merge-download.ts`
- Create: `packages/web/components/MergeToolClient.tsx`

**Interfaces:**
- Consumes: `parseDelimited`, `deriveFields`, `autoMatchColumns`, `Rows`, `DocumentSpec` from `@event-editor/core/merge`; `parseWorkbook` (`@/lib/merge-xlsx`); `renderCombined`/`renderZip`/`renderSheet`/`loadBundledFonts`/`FontBytes` (`@/lib/merge-render`); `Segmented`, `FileDrop`.
- Produces:
  - `AttendeeListInput({ onRows }: { onRows: (r: Rows) => void })` — the three-source loader (paste / upload / Google Sheet), surfacing its own error text. Encapsulates the F1 list logic so tools don't duplicate it.
  - `merge-download.ts`: `triggerDownload(blob: Blob, name: string): void` and `withFonts(): Promise<FontBytes | undefined>` (loads bundled fonts, swallows failure → undefined so render falls back to Helvetica).
  - `MergeToolClient(props: MergeToolConfig)` — renders `AttendeeListInput`, a layout `Segmented`, the config's copy inputs + recipient-column input + optional toggles, live row count, and the output buttons (Combined PDF = accent, Zip, and — when `sheet` is set — Cut sheet). Builds the spec via `config.buildSpec`, remaps rows so the recipient token resolves against the matched column, and gates downloads on a matched recipient column.

```ts
export interface MergeField { key: string; label: string; default: string }
export interface MergeToolConfig {
  layouts: readonly { id: string; label: string }[];
  copyFields: MergeField[];      // constant text inputs (event title, etc.)
  toggles?: { key: string; label: string; default: boolean }[]; // e.g. { key: "qr", label: "Include a QR code" }
  recipientLabel: string;        // e.g. "Name column"
  recipientDefault: string;      // "Name"
  sheet: boolean;                // offer the N-up cut sheet output
  fileBase: string;              // download base name, e.g. "badges"
  buildSpec: (v: { layout: string; text: Record<string, string>; toggles: Record<string, boolean>; recipientField: string }) => DocumentSpec;
}
```

- [ ] **Step 1: AttendeeListInput** (lift the F1 list logic; open `app/certificate/CertificateClient.tsx` for the exact source shapes):

```tsx
// packages/web/components/AttendeeListInput.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Segmented } from "@/components/Segmented";
import { FileDrop } from "@/components/FileDrop";
import { parseDelimited, type Rows } from "@event-editor/core/merge";
import { parseWorkbook } from "@/lib/merge-xlsx";

type Source = "paste" | "upload" | "sheet";

export function AttendeeListInput({ onRows }: { onRows: (r: Rows) => void }) {
  const [source, setSource] = useState<Source>("paste");
  const [pasteText, setPasteText] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  function emit(r: Rows) { setCount(r.rows.length); onRows(r); }

  useEffect(() => {
    if (source === "paste") emit(parseDelimited(pasteText));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, pasteText]);

  async function onUpload(file: File) {
    setError(null);
    try { emit(parseWorkbook(await file.arrayBuffer())); }
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
      emit(data);
    } catch { setError("Could not load that sheet."); }
    finally { setBusy(false); }
  }

  return (
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
        <textarea className="field mt-3 h-32 w-full" placeholder="One name per line, or paste columns from a spreadsheet"
          value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
      )}
      {source === "upload" && (
        <div className="mt-3">
          <FileDrop inputRef={fileRef} accept=".csv,.xlsx" label="Drop a CSV or XLSX here, or click to browse"
            onChange={(has) => { if (has && fileRef.current?.files?.[0]) onUpload(fileRef.current.files[0]); }} />
        </div>
      )}
      {source === "sheet" && (
        <div className="mt-3 flex gap-2">
          <input className="field flex-1" placeholder="Paste a Google Sheet link" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
          <button className="btn" onClick={loadSheet} disabled={busy || !sheetUrl}>Load</button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-2 text-sm text-muted">{count} {count === 1 ? "row" : "rows"} loaded</p>
    </div>
  );
}
```

- [ ] **Step 2: download helpers**

```ts
// packages/web/lib/merge-download.ts
import { loadBundledFonts, type FontBytes } from "@/lib/merge-render";

export function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function withFonts(): Promise<FontBytes | undefined> {
  try { return await loadBundledFonts(); } catch { return undefined; }
}
```

- [ ] **Step 3: MergeToolClient**

```tsx
// packages/web/components/MergeToolClient.tsx
"use client";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { AttendeeListInput } from "@/components/AttendeeListInput";
import { autoMatchColumns, deriveFields, type Rows, type DocumentSpec } from "@event-editor/core/merge";
import { renderCombined, renderZip, renderSheet } from "@/lib/merge-render";
import { triggerDownload, withFonts } from "@/lib/merge-download";

export interface MergeField { key: string; label: string; default: string }
export interface MergeToolConfig {
  layouts: readonly { id: string; label: string }[];
  copyFields: MergeField[];
  toggles?: { key: string; label: string; default: boolean }[];
  recipientLabel: string;
  recipientDefault: string;
  sheet: boolean;
  fileBase: string;
  buildSpec: (v: { layout: string; text: Record<string, string>; toggles: Record<string, boolean>; recipientField: string }) => DocumentSpec;
}

export function MergeToolClient(config: MergeToolConfig) {
  const [rows, setRows] = useState<Rows>({ headers: [], rows: [] });
  const [layout, setLayout] = useState<string>(config.layouts[0].id);
  const [text, setText] = useState<Record<string, string>>(
    Object.fromEntries(config.copyFields.map((f) => [f.key, f.default])),
  );
  const [toggles, setToggles] = useState<Record<string, boolean>>(
    Object.fromEntries((config.toggles ?? []).map((t) => [t.key, t.default])),
  );
  const [recipientField, setRecipientField] = useState(config.recipientDefault);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const spec = useMemo(
    () => config.buildSpec({ layout, text, toggles, recipientField }),
    [config, layout, text, toggles, recipientField],
  );
  const fields = useMemo(() => deriveFields(spec), [spec]);
  const mapping = useMemo(() => autoMatchColumns(fields, rows.headers), [fields, rows.headers]);
  const recipientColumn = mapping[recipientField] ?? recipientField;

  const mergedRows = useMemo(
    () => rows.rows.map((r) => {
      const out = { ...r };
      // resolve every derived field's token against its matched column
      for (const fld of fields) {
        const col = mapping[fld] ?? fld;
        out[fld] = r[col] ?? r[fld] ?? "";
      }
      return out;
    }),
    [rows.rows, fields, mapping],
  );

  const columnOk = rows.headers.length === 0 || rows.headers.includes(recipientColumn);
  const ready = mergedRows.length > 0 && columnOk;

  async function download(kind: "combined" | "zip" | "sheet") {
    setBusy(true); setError(null);
    try {
      const fonts = await withFonts();
      if (kind === "combined") {
        const bytes = await renderCombined(spec, mergedRows, fonts);
        triggerDownload(new Blob([bytes], { type: "application/pdf" }), `${config.fileBase}.pdf`);
      } else if (kind === "sheet") {
        const bytes = await renderSheet(spec, mergedRows, fonts);
        triggerDownload(new Blob([bytes], { type: "application/pdf" }), `${config.fileBase}-sheet.pdf`);
      } else {
        const blob = await renderZip(spec, mergedRows, recipientField, fonts);
        triggerDownload(blob, `${config.fileBase}.zip`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-8 space-y-5">
      <AttendeeListInput onRows={setRows} />

      <div className="card space-y-3">
        <p className="text-sm font-medium">Design</p>
        <Segmented options={config.layouts.map((l) => ({ value: l.id, label: l.label }))} value={layout} onChange={setLayout} />
        {config.copyFields.map((f) => (
          <label key={f.key} className="block text-sm font-medium">{f.label}
            <input className="field mt-1 w-full" value={text[f.key] ?? ""} onChange={(e) => setText((s) => ({ ...s, [f.key]: e.target.value }))} />
          </label>
        ))}
        <label className="block text-sm font-medium">{config.recipientLabel}
          <input className="field mt-1 w-full" value={recipientField} onChange={(e) => setRecipientField(e.target.value)} />
        </label>
        {(config.toggles ?? []).map((t) => (
          <label key={t.key} className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={!!toggles[t.key]} onChange={(e) => setToggles((s) => ({ ...s, [t.key]: e.target.checked }))} />
            {t.label}
          </label>
        ))}
        {rows.headers.length > 0 && !columnOk && (
          <p className="text-sm text-amber-600">No “{recipientColumn}” column found. Available: {rows.headers.join(", ")}.</p>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="card flex flex-wrap gap-3">
        <button className="btn btn-accent inline-flex items-center gap-2" onClick={() => download("combined")} disabled={!ready || busy}>
          <Download className="w-4 h-4" strokeWidth={1.75} /> Combined PDF
        </button>
        <button className="btn inline-flex items-center gap-2" onClick={() => download("zip")} disabled={!ready || busy}>
          <Download className="w-4 h-4" strokeWidth={1.75} /> Zip of files
        </button>
        {config.sheet && (
          <button className="btn inline-flex items-center gap-2" onClick={() => download("sheet")} disabled={!ready || busy}>
            <Download className="w-4 h-4" strokeWidth={1.75} /> Cut sheet
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

`npx tsc --noEmit` in packages/web — no new errors referencing the three new files. (No unit test — these are wiring components exercised by the tool pages in Tasks 10-12 and the manual smoke.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/AttendeeListInput.tsx packages/web/lib/merge-download.ts packages/web/components/MergeToolClient.tsx
git commit -m "feat(merge): shared attendee list input, download helpers, MergeToolClient"
```

---

### Task 10: Web — badge, place-card, ticket pages

**Files:**
- Create: `packages/web/app/badge/page.tsx`
- Create: `packages/web/app/place-card/page.tsx`
- Create: `packages/web/app/ticket/page.tsx`

**Interfaces:**
- Consumes: `MergeToolClient` + `MergeToolConfig`; `badgeSpec`/`BADGE_LAYOUTS`, `placecardSpec`/`PLACECARD_LAYOUTS`, `ticketSpec`/`TICKET_LAYOUTS` from their core subpaths.
- Produces: the three routes, each a server component holding a config and rendering `<MergeToolClient {...config} />`. Match `app/certificate/page.tsx`'s shell (heading + muted description + container). Config `buildSpec` closes over the core spec builder.

- [ ] **Step 1: Badge page**

```tsx
// packages/web/app/badge/page.tsx
import { MergeToolClient, type MergeToolConfig } from "@/components/MergeToolClient";
import { badgeSpec, BADGE_LAYOUTS } from "@event-editor/core/badge";

export const metadata = { title: "Make name badges" };

const config: MergeToolConfig = {
  layouts: BADGE_LAYOUTS,
  copyFields: [
    { key: "eventTitle", label: "Event title", default: "" },
    { key: "orgField", label: "Organisation column", default: "Org" },
  ],
  toggles: [{ key: "qr", label: "Include a QR code of each name", default: false }],
  recipientLabel: "Name column",
  recipientDefault: "Name",
  sheet: true,
  fileBase: "badges",
  buildSpec: ({ layout, text, toggles, recipientField }) =>
    badgeSpec({
      layout: layout as "centered" | "leftQr",
      nameField: recipientField,
      orgField: text.orgField || "Org",
      eventTitle: text.eventTitle || "",
      qr: !!toggles.qr,
    }),
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Make name badges</h1>
      <p className="mt-2 text-muted">Turn a list into printable name badges, six to an A4 sheet. Nothing leaves your browser.</p>
      <MergeToolClient {...config} />
    </main>
  );
}
```

- [ ] **Step 2: Place-card page**

```tsx
// packages/web/app/place-card/page.tsx
import { MergeToolClient, type MergeToolConfig } from "@/components/MergeToolClient";
import { placecardSpec, PLACECARD_LAYOUTS } from "@event-editor/core/placecard";

export const metadata = { title: "Make place cards" };

const config: MergeToolConfig = {
  layouts: PLACECARD_LAYOUTS,
  copyFields: [{ key: "tableField", label: "Table column", default: "Table" }],
  recipientLabel: "Name column",
  recipientDefault: "Name",
  sheet: true,
  fileBase: "place-cards",
  buildSpec: ({ layout, text, recipientField }) =>
    placecardSpec({
      layout: layout as "classic" | "withTable",
      nameField: recipientField,
      tableField: text.tableField || "Table",
    }),
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Make place cards</h1>
      <p className="mt-2 text-muted">Turn a guest list into printable table place cards. Nothing leaves your browser.</p>
      <MergeToolClient {...config} />
    </main>
  );
}
```

- [ ] **Step 3: Ticket page**

```tsx
// packages/web/app/ticket/page.tsx
import { MergeToolClient, type MergeToolConfig } from "@/components/MergeToolClient";
import { ticketSpec, TICKET_LAYOUTS } from "@event-editor/core/ticket";

export const metadata = { title: "Make event tickets" };

const config: MergeToolConfig = {
  layouts: TICKET_LAYOUTS,
  copyFields: [
    { key: "eventTitle", label: "Event title", default: "" },
    { key: "codeField", label: "QR code column (defaults to name)", default: "" },
  ],
  toggles: [{ key: "qr", label: "Include a QR code", default: true }],
  recipientLabel: "Name column",
  recipientDefault: "Name",
  sheet: true,
  fileBase: "tickets",
  buildSpec: ({ layout, text, toggles, recipientField }) =>
    ticketSpec({
      layout: layout as "classic" | "minimal",
      eventTitle: text.eventTitle || "",
      nameField: recipientField,
      codeField: text.codeField || "",
      qr: !!toggles.qr,
    }),
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Make event tickets</h1>
      <p className="mt-2 text-muted">Turn a list into event tickets with a QR code each. Nothing leaves your browser.</p>
      <MergeToolClient {...config} />
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build sanity**

`npx tsc --noEmit` in packages/web — no new errors from the three pages. Optionally `npm run build -w @event-editor/web` to confirm the routes compile. Full browser smoke is the controller's/Caleb's follow-up.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/badge packages/web/app/place-card packages/web/app/ticket
git commit -m "feat(f2): badge, place-card, ticket tool pages"
```

---

### Task 11: Register the three tools in the discovery shell

**Files:**
- Modify: `packages/web/components/tools.ts`
- Modify (if present): the tools registry test (`packages/web/test/tools.test.ts`) and `test/tool-store.test.ts` count/id/group assertions.

**Interfaces:**
- Consumes: the `Tool` shape + `TOOLS` array.
- Produces: `badge`, `place-card`, `ticket` entries in `TOOLS`, all in the existing `events` group.

- [ ] **Step 1: Add imports + entries**

Add `IdCard`, `Tent`, `Ticket` to the `lucide-react` import (confirm each is a real lucide export; if `Tent` is unavailable use `Utensils` or `StickyNote`). Append to `TOOLS`:

```ts
  {
    id: "badge",
    href: "/badge",
    title: "Make name badges",
    body: "Turn a list into printable name badges, six to a sheet.",
    Icon: IdCard,
    defaultGroups: ["events"],
    tags: ["badge", "name", "lanyard", "merge", "event", "qr"],
  },
  {
    id: "place-card",
    href: "/place-card",
    title: "Make place cards",
    body: "Turn a guest list into printable table place cards.",
    Icon: Tent,
    defaultGroups: ["events"],
    tags: ["place card", "table", "seating", "name", "event"],
  },
  {
    id: "ticket",
    href: "/ticket",
    title: "Make event tickets",
    body: "Turn a list into event tickets, each with its own QR code.",
    Icon: Ticket,
    defaultGroups: ["events"],
    tags: ["ticket", "qr", "admit", "event", "merge"],
  },
```

- [ ] **Step 2: Update registry tests**

Search for a test asserting the tool count or id list (`grep -rn "toHaveLength\|certificate\|\"qr\"" packages/web/test`). Update the expected count (was 13 after F1 → 16) and add `"badge"`, `"place-card"`, `"ticket"` to any expected-ids array. If `tool-store.test.ts` asserts the `events` group's members, add the three ids there. Do NOT weaken any other assertion.

- [ ] **Step 3: Run the registry tests + typecheck**

`npm test -w @event-editor/web -- tools tool-store` — PASS.
`npx tsc --noEmit` in packages/web — no new errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/components/tools.ts packages/web/test
git commit -m "feat(f2): register badge, place-card, ticket in the discovery shell"
```

---

## Self-Review (F2)

- **Spec coverage:** QR element (T1), N-up tiling (T2, T8), badge/place-card/ticket builders (T3-5), core exports (T6), image+QR rendering (T7), cut-sheet render (T8), shared UI (T9), three pages (T10), registry (T11). Combined/zip/sheet outputs all wired in the shared client. Google Sheet reuses F1's route (no new route). Deferred by design and noted: folded-tent place card (needs text rotation), custom-background (F3).
- **Types:** `QrElement`, `Grid`/`Placement`, `BadgeOptions`/`PlaceCardOptions`/`TicketOptions`, `MergeToolConfig`/`MergeField` defined once and consumed by name. `renderSheet`/`SheetOptions` names match between T8 and T9. `drawPage`'s new async+offset signature is updated at both F1 call sites in T7.
- **Placeholders:** none. The one runtime guard is the `Tent` icon fallback in T11, resolved at implementation by checking the lucide export.
- **DRY note:** certificate (F1) keeps its bespoke client; a later cleanup can migrate it onto `MergeToolClient`. Not done here to avoid touching a shipped tool.

---

## Follow-ups (not in F2)

- Folded-tent place card (name printed twice, top half rotated 180°) — needs a `rotation` field on `TextElement` and rotation-aware alignment in `drawPage`.
- Migrate `CertificateClient` onto `MergeToolClient` to remove the two-pattern split.
- Per-tool illustrations for badge/place-card/ticket (handled in the separate thumbnail pass).
