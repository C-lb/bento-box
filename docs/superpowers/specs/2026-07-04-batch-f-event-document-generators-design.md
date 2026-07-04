# Batch F — Event document generators (design)

Date: 2026-07-04
Status: Approved for spec, awaiting implementation plan
Scope: Whole batch F, phased (F1 / F2 / F3)

## Summary

Batch F adds four event-document generators to the tool suite: `/certificate`,
`/badge`, `/place-card`, and `/ticket`. Each is a thin, opinionated front-end
over one shared, client-side **merge engine** that turns an attendee list plus a
document template into a batch of personalised, print-ready files.

The tools differ only in what is genuinely tool-specific: page size and
orientation, their set of built-in layouts, whether they arrange output N-up on a
cut sheet, and whether they carry a QR code. Everything else — list parsing,
column-to-field mapping, rendering, output packaging, live preview — lives in the
shared core.

## Goals

- Generate personalised certificates, name badges, table place cards, and event
  tickets from a list, without a designer or a desktop tool.
- On-brand by default (built-in SPARK layouts), with an escape hatch for fully
  custom designs (upload your own background, place fields).
- Keep attendee PII (names, orgs, emails) on the user's machine — render locally.
- Fit the existing single-purpose, opinionated tool philosophy and the discovery
  shell.

## Non-goals

- No visual designer for building a template *from scratch* — custom designs come
  in as a finished background (PDF/PNG) the user made elsewhere (Canva etc.).
- No email sending. Output is files the user downloads; emailing is out of scope.
- No stored templates / accounts / server-side template library in this batch.
  Custom field placements live in the browser session only.
- No server-side rendering. (See Rendering.)

## Core decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Shape | Purpose-built generators (4 tools) over one shared merge core |
| Tools | certificate, badge, place card, ticket |
| Template model | Both: built-in SPARK layouts **and** upload-your-own-background + field placement |
| Data sources | CSV / XLSX upload, paste names, Google Sheet link |
| Output | User picks combined multi-page PDF **or** zip of individually-named files; badges + place cards also get an N-up cut sheet |
| Rendering | Client-side (pdf-lib in the browser); PII never leaves the machine |

## Architecture

All rendering and parsing runs in the browser. The only server touch is a thin
OAuth route to fetch Google Sheet rows as JSON — it does no rendering and stores
nothing.

```
list source ──┐
 • CSV/XLSX    │   parse → rows[]      map columns      render per row       package
 • paste       ├──▶ (browser) ──▶  → template fields ──▶ (pdf-lib, browser) ──▶ combined PDF
 • Sheet URL ──┘        ▲                                                        or zip
                  /api/sheet (thin OAuth route,                            (+ N-up for badges/
                   returns rows JSON — no rendering)                        place cards)
```

### Shared merge core (client-side module)

A single module under `packages/web/components` (or `lib`), consumed by all four
tool routes. Responsibilities, each a small well-bounded unit:

1. **List ingestion → `rows[]`**
   - CSV/XLSX: parse with `xlsx` (SheetJS). First row = headers.
   - Paste: textarea; one row per line. Tab/comma-separated → multiple columns,
     else a single `Name` column.
   - Google Sheet: `POST /api/sheet` with the URL; route uses existing Google
     OAuth to read the sheet and returns `{ headers, rows }`. No rendering, no
     persistence.
   - Output shape is identical regardless of source: `{ headers: string[], rows: Record<string,string>[] }`.

2. **Column → field mapping**
   - The active template declares named fields (e.g. `Name`, `Org`, `Date`).
   - UI maps each field to a spreadsheet column (auto-match on header name, user
     can override). Constant fields (event title, date-for-all) set once, not
     per-column.

3. **Document spec → rendered bytes**
   - A `DocumentSpec` = page size/orientation + a list of drawn elements
     (static text, static image/logo, and per-row field placeholders with
     position, font, size, align, colour).
   - `renderRow(spec, row) → Uint8Array` draws one page/file with pdf-lib.
   - Built-in layouts are code that produces a `DocumentSpec`. Custom (F3) uploads
     a background and produces a `DocumentSpec` whose base is that background image
     plus user-placed field elements.
   - Custom fonts embedded via `@pdf-lib/fontkit` from bundled TTFs.

4. **Output packaging**
   - Combined PDF: one document, one page per row (pdf-lib).
   - Zip: one file per row, named from a chosen column (`jszip`, already a dep).
   - N-up sheet (badges/place cards): tile M rows per page on a cut sheet with
     crop guides.

5. **Live preview**
   - Render row 1 to a canvas/`<embed>` so the user sees the result before
     generating the whole batch. Re-renders on mapping/layout changes.

### Per-tool front-ends (thin)

Each route (`/certificate`, `/badge`, `/place-card`, `/ticket`) supplies only:

| Tool | Page | Built-in layouts | N-up | QR |
|---|---|---|---|---|
| certificate | A4 landscape | 2–3 (Classic / Modern / Minimal) | no | no |
| badge | badge insert size | 2–3 | yes (sheet) | optional |
| place card | folded tent card | 2 | yes (sheet) | no |
| ticket | ticket strip | 1–2 | optional | yes (name + code) |

Ticket and badge QR reuse the existing `qrcode` dependency from `/qr`.

### Discovery shell registration

Add four entries to `packages/web/components/tools.ts`, all in the existing
`events` group. Certificate additionally tagged into `documents`. Follow the
existing `Tool` shape (id, href, title, body, Icon, defaultGroups, tags). Icons
from `lucide-react` (e.g. `Award`, `IdCard`, `Tent`/`StickyNote`, `Ticket`).
Confirm the existing-install group-merge path (the batch-B lesson: new default
groups must union into persisted `ee.toolShell` state) — here the group already
exists, so this is a check, not new work.

## Dependencies (license-checked up front)

Per the batch-E lesson (front-load the license gate on any new dep):

| Dep | Purpose | License | Status |
|---|---|---|---|
| `xlsx` (SheetJS community) | CSV + XLSX parsing | Apache-2.0 | new, OK |
| `@pdf-lib/fontkit` | custom TTF embedding in pdf-lib | MIT | new, OK |
| bundled fonts (Google Fonts) | on-brand certificate/badge type | OFL | new asset, OK |
| `pdf-lib` | rendering | — | existing |
| `jszip` | zip packaging | — | existing |
| `qrcode` | ticket/badge QR | — | existing |
| Google OAuth plumbing | Sheet fetch | — | existing (sorter/studio/transcribe) |

No AGPL / non-commercial deps. If `xlsx` bundle size is a concern, CSV-only via a
lighter parser is a fallback, but XLSX support is worth the weight for this audience.

## Phasing (within batch F)

Ship value early, de-risk the canvas editor last.

- **F1 — spine.** Merge core + `/certificate` with built-in SPARK layouts, all
  three data sources, both output packages. Proves the whole pipeline on one tool.
- **F2 — breadth.** `/badge`, `/place-card`, `/ticket`: layouts, N-up cut sheets,
  QR. Mostly layout variants once F1's plumbing exists.
- **F3 — flexibility.** "Upload your own background" + the mini canvas
  field-placement editor, wired into all four tools. Built last, on proven ground.

Each phase gets its own implementation plan. This spec is the shared reference.

## Error handling

- Empty / malformed list → clear message, no silent partial render.
- Missing required field mapping → block generate, name the unmapped field.
- Google Sheet: not-shared / auth-expired / bad URL → explicit, actionable errors
  (mirror the existing Drive-picker error copy).
- Row with a blank in a placeholder → render blank, don't crash; optionally flag
  count of rows with blanks before generating.
- Large batch → show progress; generation is async and cancellable.

## Testing

- Core units testable in isolation: list parsers (CSV/XLSX/paste each →
  identical `rows[]` shape), column auto-match, `renderRow` (assert placeholder
  substitution and element placement), packaging (page count = row count; zip
  entry names).
- Per-tool: layout produces a valid `DocumentSpec`; N-up tiling math; QR present
  where expected.
- Human smoke per tool: real list → combined PDF + zip open correctly, names
  land in the right place, print bleed/margins sane. (Batch-E lesson: owe a real
  round-trip, don't trust the guard-green.)

## Open questions (resolve during F1 planning)

- Exact badge / place-card / ticket physical dimensions (SPARK's lanyard stock).
- Which 2–3 certificate layouts, and their copy defaults.
- Bundled font choices (heading + body).
