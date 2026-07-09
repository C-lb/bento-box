# Nav History Controls + Link Shortener + Card/Certificate Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three features per the approved spec (`docs/superpowers/specs/2026-07-09-nav-shortener-card-designer-design.md`): (A) back/forward/refresh buttons in the topbar, (B) a `/shorten` link-shortener tool backed by is.gd/v.gd, (C) design customisation (dimensions, fonts, sizes, tracking, text strokes, borders, dividers) with a live PDF preview across the four merge tools (certificate, badge, place card, ticket).

**Architecture:** A stays inside `Nav.tsx`. B is a thin `/api/shorten` proxy route + a client page reusing `Segmented`/`CopyButton`/`qrcode`. C extends the pure `DocumentSpec` model in core (`slot`/`fontId`/`letterSpacing`/`stroke` on text, new rect/line elements), adds a pure `applyDesign(spec, overrides)` in `packages/core/src/design.ts`, upgrades `merge-render.ts` (font pool, char-spacing + text-rendering-mode operators, rect/line), and adds two shared components — `MergePreview` (renderOne → pdfjs rasterise) and `DesignPanel` — wired into all four tool clients with per-tool localStorage persistence.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, pdf-lib (+ `setCharacterSpacing`/`setTextRenderingMode` operators — verified exported), pdfjs-dist (browser rasterise), qrcode, lucide-react.

## Global Constraints

- Test runner: from `packages/web` and `packages/core`, `npx vitest run <path>`.
- Core imports use subpath form `@event-editor/core/<module>`; after changing `packages/core`, run `npm run -w @event-editor/core build` before web consumes new exports. New core module `design.ts` needs a matching subpath export if `package.json` lists exports explicitly — check and mirror how `merge`/`nup` are exposed.
- Turbopack gotcha: extensionless relative imports break; core-internal imports use `./x.js` style (match existing files).
- House style: anti-vibecode (flat buttons, one accent, sentence case, no em dashes in copy), `Segmented` reuse, 44px mobile targets, `text-amber-600` not `text-warning`.
- Backward compatibility: specs without new optional fields must render byte-identically; `FontBytes` heading/body path preserved.
- Commit per task to `main` and push (Caleb's standing rule); no branches.

---

### Task 1: `/api/shorten` proxy route (TDD)

**Files:**
- Create: `packages/web/app/api/shorten/route.ts`
- Create: `packages/web/test/shorten-route.test.ts`
- Create: `packages/web/lib/shorten.ts` (pure request-building + validation + error mapping, so it's unit-testable without Next)

**Interfaces:**
- `lib/shorten.ts` exports: `validateLongUrl(s): string | null` (error message or null), `validateCustomName(s): string | null` (5–30 chars, `[A-Za-z0-9_]`), `buildCreateUrl(service, url, custom?): string`, `mapServiceError(errorcode?: number): string`.
- Route: `POST { url, custom?, service? }` → `200 { shorturl }` | `400/502 { error }`.

- [ ] **Step 1: Write failing tests** — validation accept/reject cases; `buildCreateUrl` encodes url + optional `shorturl` param with `format=json`; error mapping for codes 1–4 and undefined; route handler tests with mocked global `fetch` (success `{ shorturl }`, error `{ errorcode, errormessage }`, network throw → 502, invalid body → 400, service whitelist — anything not `is.gd`/`v.gd` → 400).
- [ ] **Step 2: Implement** `lib/shorten.ts` + route. Route calls `fetch(buildCreateUrl(...))` with a 10s `AbortSignal.timeout`, parses JSON defensively.
- [ ] **Step 3: Verify** `cd packages/web && npx vitest run test/shorten-route.test.ts` green, then full web suite green. Commit `feat(shorten): is.gd proxy route with validation and error mapping`.

### Task 2: `/shorten` tool page + registry entry

**Files:**
- Create: `packages/web/app/shorten/page.tsx`, `packages/web/app/shorten/ShortenClient.tsx`
- Modify: `packages/web/components/tools.ts` (registry entry)

**Interfaces:**
- Registry: id `shorten`, href `/shorten`, title "Shorten a link", body "Turn a long link into a short is.gd one, with an optional custom name.", group `utilities`, tags `["link","url","shorten","short","qr","custom"]`, no requirements.

- [ ] **Step 1: Page + client.** Match an existing simple client (e.g. `app/qr/`) for page scaffold. UI per spec: URL input; custom-name input with live `is.gd/` prefix hint and inline validation message; `Segmented` for is.gd / "v.gd (shows a preview page)"; Shorten button (busy state); result card with link + `CopyButton` + QR canvas (`qrcode` toDataURL, ~200px) + Download PNG.
- [ ] **Step 2: History.** `ee.shorten.history` localStorage (`{v:1, items:[{long, short, at}]}`, defensive parse, cap 20, newest first), rows with short link + truncated long URL + copy, "Clear history".
- [ ] **Step 3: Verify** dev server renders `/shorten`, card appears under Utilities pill, search finds "shorten". Run web suite. Commit `feat(shorten): link shortener tool with custom names, QR and history`.

### Task 3: Nav back/forward/refresh controls

**Files:**
- Modify: `packages/web/components/Nav.tsx`

- [ ] **Step 1: Add the button cluster** between the Bento link and the pills `<nav>`: three buttons (lucide `ArrowLeft`, `ArrowRight`, `RotateCw`, size 18, strokeWidth 1.75), styling mirroring the Settings link (`text-muted hover:text-ink`, min 44px targets, rounded-lg, `shrink-0`). Handlers: `history.back()`, `history.forward()`, `location.reload()`. `aria-label`s "Go back" / "Go forward" / "Refresh".
- [ ] **Step 2: Disabled states via Navigation API when present.** In a `useEffect`, feature-detect `window.navigation`; subscribe to `currententrychange` to set `canBack`/`canForward` state from `navigation.canGoBack/canGoForward`; unsubscribe on cleanup. Without the API, both stay enabled. Disabled rendering: `opacity-40 cursor-default`, `aria-disabled`, click no-op. TS note: `window.navigation` isn't in lib.dom — use a small local type declaration, no `any` leakage.
- [ ] **Step 3: Verify** at desktop and 390px widths (wordmark hidden, no overflow; pills still scroll). Commit `feat(nav): back, forward and refresh controls beside the Bento mark`.

### Task 4: Core model + `applyDesign` (TDD)

**Files:**
- Modify: `packages/core/src/merge.ts` (TextElement optional fields `slot`/`fontId`/`letterSpacing`/`stroke`; new `RectElement`, `LineElement`; `Element` union)
- Create: `packages/core/src/design.ts`, `packages/core/src/design.test.ts`
- Modify: `packages/core/src/certificate.ts`, `badge.ts`, `placecard.ts`, `ticket.ts` (tag text elements with `slot` ids)
- Modify: `packages/core/package.json` exports if subpaths are explicit

**Interfaces:**
- `design.ts` exports `TextStyle`, `DesignOverrides` (shape per spec, `v: 1`), `applyDesign(spec, overrides?): DocumentSpec`, and `MM_TO_PT = 2.83465`.

- [ ] **Step 1: Failing tests** for: identity when overrides undefined/empty; per-axis position scaling + min-axis text scaling on pageSize change; image/qr size scaling; absolute per-slot `size` wins after scaling; slot style merge (fontId, letterSpacing, color, stroke; `stroke: null` removes); border single = 1 rect at inset, double = 2 rects with the spec's gap formula; divider injection geometry; layout factories emit expected slot sets (certificate: title/body/recipient/detail/date/signature per layout, etc. — enumerate from each factory).
- [ ] **Step 2: Implement** model fields, `applyDesign` (pure, never mutates input), slot tagging in the four factories.
- [ ] **Step 3: Verify** `cd packages/core && npx vitest run` all green (existing suites too), `npm run -w @event-editor/core build`. Commit `feat(core): design overrides model and applyDesign for merge tools`.

### Task 5: Renderer upgrades (TDD)

**Files:**
- Modify: `packages/web/lib/merge-render.ts`
- Modify: `packages/web/lib/merge-render.test.ts`

**Interfaces:**
- `FontBytes` becomes `{ heading?: Uint8Array; body?: Uint8Array; byId?: Record<string, Uint8Array> }` (additive — existing callers unchanged).
- Render fns' signatures otherwise unchanged.

- [ ] **Step 1: Failing tests:** letter-spaced centred text x-position accounts for `(len-1)×spacing`; content stream contains `Tc` (char spacing) and `Tr` (rendering mode) operators when used, and resets after; rect/line elements draw with n-up `ox/oy` offsets (parse page content or assert via pdf-lib page ops); unknown `fontId` falls back to role font without throwing; `renderSheet` with an oversized cell throws `"Card is too large for the sheet"`.
- [ ] **Step 2: Implement:** font pool in `embedFonts` (embed distinct `fontId`s from spec once; per-element resolve fontId → role → Standard); wrap `drawText` with `pushOperators(setCharacterSpacing(n))`/reset when `letterSpacing`; stroke via `setTextRenderingMode(TextRenderingMode.FillAndOutline)` + `setStrokingColor` + `setLineWidth`, reset to `Fill`; `drawRectangle`/`drawLine` for the new kinds; oversized-cell guard in `renderSheet`.
- [ ] **Step 3: Verify** web suite green (existing merge-render tests must pass untouched — backward compat). Commit `feat(render): font pool, tracking, text strokes, rects and lines`.

### Task 6: Designer fonts — bundle + registry + session upload

**Files:**
- Create: `packages/web/public/fonts/designer/*.ttf` (downloaded, OFL)
- Create: `packages/web/lib/designer-fonts.ts` (+ colocated test for registry shape/loader caching with mocked fetch)

- [ ] **Step 1: Download fonts** (regular + bold where available) from Google Fonts' GitHub (`github.com/google/fonts/raw/main/ofl/<family>/...`): Inter, DM Sans, Playfair Display, Cormorant Garamond, Great Vibes (regular only), Oswald, Space Mono. Verify each file is a real TTF (`file` output), total size logged. Include each family's OFL licence text in `public/fonts/designer/LICENSES.md`.
- [ ] **Step 2: Registry + loader:** `DESIGNER_FONTS: { id, label, file, category }[]`; `loadFontById(id): Promise<Uint8Array>` with an in-memory cache; `sessionUploads: Map<string, Uint8Array>` helpers (`addUploadedFont(name, bytes)`, listed alongside curated fonts). Loader test with mocked fetch (cache hit = one fetch).
- [ ] **Step 3: Verify** suite green; fonts served at `/fonts/designer/...` in dev. Commit `feat(design): bundled OFL font set, registry and session uploads`.

### Task 7: `MergePreview` live preview component

**Files:**
- Create: `packages/web/components/MergePreview.tsx`
- Modify: `packages/web/package.json` scripts or `next.config.ts` only if the pdfjs worker needs a copy step

**Interfaces:**
- `<MergePreview spec={DocumentSpec} row={Record<string,string>} fonts={FontBytes | undefined} />` — self-contained canvas + spinner.

- [ ] **Step 1: Browser rasterise path.** Dynamic-import `pdfjs-dist` client-side; resolve the worker via `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` first; if Turbopack fights it, copy the worker into `public/` in `predev`/`prebuild` (pattern exists for MediaPipe) and set `GlobalWorkerOptions.workerSrc` to that path.
- [ ] **Step 2: Render loop.** Debounce 300ms on `spec`/`row`/`fonts` changes; call the existing single-page render (export `renderOne` from `merge-render.ts` if not already exported); rasterise page 1 at container width × devicePixelRatio onto `<canvas>`; monotonically-increasing render token so stale renders never paint; thin spinner overlay while rendering; placeholder row (field name as value) when `row` empty.
- [ ] **Step 3: Verify** manually in dev on `/certificate`: preview appears, updates when title text changes, no console errors, stale-render safe under fast typing. Commit `feat(design): live WYSIWYG PDF preview component`.

### Task 8: `DesignPanel` component + persistence

**Files:**
- Create: `packages/web/components/DesignPanel.tsx`
- Create: `packages/web/components/design-store.ts` (+ colocated test)

**Interfaces:**
- `design-store.ts`: `loadDesign(toolId): DesignOverrides | undefined`, `saveDesign(toolId, o)`, `clearDesign(toolId)` — key `ee.design.<toolId>`, `{v:1,…}`, defensive parse (test: garbage/old versions → undefined).
- `<DesignPanel toolId presets={SizePreset[]} slots={{id,label}[]} value={DesignOverrides} onChange={(o)=>void} onUploadFont={(name,bytes)=>void} uploadedFonts={string[]} />` — controlled component; parents own state + persistence.

- [ ] **Step 1: Store + tests.**
- [ ] **Step 2: Panel UI** per spec, inside a "Customise" `<details>`-style disclosure (closed by default): size preset `Segmented` + custom mm inputs (× `MM_TO_PT`); per-slot rows (font `<select>` grouped curated/uploaded, size, tracking step 0.1 allowing negatives, colour `<input type="color">`, outline toggle + colour/width); border controls; divider list add/remove; font upload input (`.ttf,.otf`) with "this session only" note; "Reset design" button. Anti-vibecode styling; 44px targets.
- [ ] **Step 3: Verify** store tests green; panel renders standalone in one tool (temporary wiring OK, finalised next task). Commit `feat(design): shared design panel with per-tool persistence`.

### Task 9: Wire all four tool clients

**Files:**
- Modify: `packages/web/app/certificate/CertificateClient.tsx`, `app/badge/BadgeClient.tsx`, `app/place-card/PlaceCardClient.tsx`, `app/ticket/TicketClient.tsx`

- [ ] **Step 1: Certificate first** (richest): state `overrides` initialised from `loadDesign("certificate")`, saved on change; `finalSpec = useMemo(applyDesign(layoutSpec, overrides))`; `MergePreview` (top of Design card on mobile, side-by-side `lg:grid-cols-2`) fed `finalSpec` + first merged row; `DesignPanel` with certificate presets (A4 landscape default, A4 portrait, A5 landscape, US Letter landscape) and the layout's slots; downloads use `finalSpec` and a font-pool `FontBytes` built from the `fontId`s in use (`loadFontById` + session uploads) merged with `loadBundledFonts()` fallback.
- [ ] **Step 2: Badge, place card, ticket** — same wiring with per-tool presets (badge: 4×3in default, A6 landscape, custom; place card/ticket: current default + custom); these render via `renderSheet`, so verify borders/dividers land inside each cell and the oversized-cell error surfaces in the existing error slot.
- [ ] **Step 3: Verify** web suite green; manual pass on all four tools: change size/font/tracking/stroke/border/divider → preview updates → downloaded PDF matches preview; reset works; reload restores persisted design. Commit `feat(design): dimensions, typography, strokes and live preview across all merge tools`.

### Task 10: Whole-branch review + smoke

- [ ] **Step 1:** `cd packages/core && npx vitest run` and `cd packages/web && npx vitest run` — all green; `npx tsc --noEmit` in web (5 pre-existing errors allowed, no new ones).
- [ ] **Step 2:** Whole-branch code review (opus/fable) over the full diff since the plan's base commit; fix findings.
- [ ] **Step 3:** Dev-server smoke: nav buttons at `/` and a tool page; `/shorten` end-to-end against real is.gd (one throwaway link, no custom name); all four merge tools preview + download. Note in the final report which items still need Caleb's manual pass (real is.gd custom name, desktop-app nav behaviour).
- [ ] **Step 4:** Push, update memory topic file. Commit message `chore: spec C batch complete (nav controls, shortener, card designer)`.
