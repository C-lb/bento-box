# Bento: nav history controls, link shortener, card & certificate designer

**Date:** 2026-07-09
**Status:** Approved design, pre-implementation
**Scope:** Three independent features in one batch (Spec C), in the web package unless noted.

---

## Feature A — Back / forward / refresh in the topbar

### What

Three icon buttons in `packages/web/components/Nav.tsx`, placed between the Bento glyph/wordmark and the group pills: back, forward, refresh. They matter most in the Electron and Capacitor shells, which have no browser chrome, but they show on all platforms and breakpoints.

### Behaviour

- **Back / forward:** `window.history.back()` / `window.history.forward()`.
- **Refresh:** `window.location.reload()` — a full reload, identical semantics in web, Electron, and Capacitor. Not `router.refresh()` (that only refetches server components).
- **Disabled states:** where the Navigation API exists (`window.navigation` — Chromium, so Electron, Chrome, Android WebView), disable back/forward when `canGoBack` / `canGoForward` is false, updating on the `currententrychange` event. Where it doesn't exist (Safari, iOS WKWebView), the buttons stay enabled and pressing them with no history is a harmless no-op. Refresh is never disabled.

### Look

- lucide icons `ArrowLeft`, `ArrowRight`, `RotateCw`, `size={18} strokeWidth={1.75}` — matches the Settings icon.
- Same treatment as the Settings link: `text-muted hover:text-ink`, 44px minimum hit target, rounded-lg. Disabled: `opacity-40`, `cursor-default`, `aria-disabled`.
- `aria-label`s: "Go back", "Go forward", "Refresh".
- On `<sm` screens the "Bento" wordmark is already hidden, so the three icons fit without crowding; the pills row keeps its `overflow-x-auto`.

---

## Feature B — Link shortener (`/shorten`)

### What

A new tool that shortens a URL via the free is.gd / v.gd API, with an optional custom name, producing `https://is.gd/<name>`. No account, no API key, no `RequirementBadge`. Registered in the `utilities` group.

### Why is.gd

Free public API, no key, supports custom slugs. Constraint accepted by Caleb: links live on is.gd's domain, custom names are global first-come-first-served, and permanence depends on is.gd staying up.

### Architecture

- **Server route** `POST /api/shorten` with body `{ url: string, custom?: string, service?: "is.gd" | "v.gd" }`. The route calls `https://<service>/create.php?format=json&url=<enc>&shorturl=<enc>` and returns `{ shorturl }` or `{ error }`. Proxying server-side sidesteps CORS and keeps error mapping in one place.
- **Error mapping** from is.gd's `errorcode`:
  - 1 → "That doesn't look like a valid link."
  - 2 → "That custom name is taken or not allowed. Try another."
  - 3 → "Rate limit reached. Wait a moment and try again."
  - 4 (or network failure) → "The shortening service is unavailable. Try again later."
- **Input validation** (client and server): URL must parse as http/https. Custom name: 5–30 characters, letters, digits, underscores (mirrors is.gd's rules; the service remains the final authority and its errors surface as above).

### Client (`/shorten`, `ShortenClient.tsx`)

- Long URL input, optional "Custom name (optional)" input with a live `is.gd/` prefix hint, service `Segmented` (is.gd default; v.gd labelled "v.gd (shows a preview page)"), Shorten button with busy state.
- Result card: the short URL as a link, `CopyButton`, and a QR code (client-side `qrcode` dep, already installed) with a "Download PNG" action.
- **History:** last 20 shortened links in `localStorage` key `ee.shorten.history` (`{ v: 1, items: [{ long, short, at }] }`, parsed defensively). Each row: short link, truncated long URL, copy. "Clear history" button.
- Requires internet (works in the desktop app when online); fetch failure shows the service-unavailable message.

### Registry entry

`tools.ts`: id `shorten`, href `/shorten`, title "Shorten a link", body "Turn a long link into a short is.gd one, with an optional custom name.", group `utilities`, tags `["link", "url", "shorten", "short", "qr", "custom"]`. No requirements.

---

## Feature C — Card & certificate designer

### What

Upgrade all four merge tools — certificate, name badge, place card, ticket — from fixed presets to customisable designs: page/card dimensions, per-text fonts, font sizes, letter spacing (tracking), colours, text outline strokes, border frames, divider lines, and a live preview. The existing three-step flow (list → design → download) and layout presets remain; presets become starting points that customisation overrides.

### Core model (`packages/core/src/merge.ts`)

- `TextElement` gains optional fields: `slot?: string` (stable id like `title`, `recipient`, `signature` — set by each layout factory), `fontId?: string` (overrides the `heading`/`body` role), `letterSpacing?: number` (pt between glyphs), `stroke?: { color: string; width: number }` (text outline).
- Two new element kinds:
  - `RectElement { kind: "rect"; x; y; width; height; strokeColor: string; strokeWidth: number }` (no fill needed yet)
  - `LineElement { kind: "line"; x1; y1; x2; y2; color: string; thickness: number }`
- `Element` union extends accordingly. `deriveFields` is unaffected (rect/line carry no templates).

### Design overrides (`packages/core/src/design.ts`, new)

A pure module that applies user customisation to a layout-produced spec:

```ts
interface TextStyle { fontId?: string; size?: number; letterSpacing?: number; color?: string; stroke?: { color: string; width: number } | null }
interface DesignOverrides {
  v: 1;
  pageSize?: { width: number; height: number };           // pt
  border?: { style: "none" | "single" | "double"; color: string; width: number; inset: number };
  dividers?: { y: number; widthFrac: number; color: string; thickness: number }[];  // y as fraction of page height
  text?: Record<string, TextStyle>;                        // keyed by slot
}
applyDesign(spec: DocumentSpec, o?: DesignOverrides): DocumentSpec
```

- **Resizing:** if `pageSize` differs from the layout's native size, every element's coordinates (and image/qr sizes) scale proportionally per axis; text sizes scale by the smaller axis factor so type doesn't distort. Explicit per-slot `size` overrides are applied *after* scaling (they are absolute).
- **Text styles:** merged onto matching-slot elements; `stroke: null` explicitly removes an outline.
- **Border:** `single` injects one inset rect; `double` injects two (outer at `inset`, inner at `inset + 3×width + 4`).
- **Dividers:** injected as centred `LineElement`s at `y × pageHeight`, spanning `widthFrac × pageWidth`.

### Fonts

- **Curated set** (all OFL), committed to `packages/web/public/fonts/designer/`: Inter, DM Sans, Playfair Display, Cormorant Garamond, Great Vibes (script), Oswald, Space Mono — regular + bold where the family has one (Great Vibes is regular-only). Registry `packages/web/lib/designer-fonts.ts`: `{ id, label, file, category }[]` plus a loader that fetches and caches bytes per session.
- **Upload slot:** a `.ttf`/`.otf` file input in the design panel; bytes held in memory for the session (not persisted — flagged in the UI as "this session only") and offered in every font picker as "Uploaded: <filename>".
- **Renderer font pool:** `merge-render.ts` replaces the fixed heading/body pair with a pool: collect the distinct `fontId`s used by the spec, embed each once, fall back per element to the existing heading/body roles, then to Helvetica. The existing `FontBytes` heading/body behaviour is preserved for specs with no `fontId`s.

### Renderer (`packages/web/lib/merge-render.ts`)

- **Letter spacing:** wrap the `drawText` call in `pushOperators(setCharacterSpacing(n))` … `pushOperators(setCharacterSpacing(0))`; alignment width becomes `font.widthOfTextAtSize(str, size) + (str.length - 1) × n`.
- **Text stroke:** around `drawText`, push `setTextRenderingMode(FillAndOutline)`, `setStrokingColor(rgb…)`, `setLineWidth(width)`; reset to `Fill` after. (Verified: pdf-lib exports `setCharacterSpacing`, `setTextRenderingMode`, `TextRenderingMode`.)
- **Rect / line:** `page.drawRectangle` / `page.drawLine` honouring the `ox`/`oy` n-up offsets, so borders and dividers work on badge/place-card/ticket sheets too.
- **n-up safety:** if a custom cell size makes `nUpGrid` place zero cells on the sheet, surface "Card is too large for the sheet" instead of rendering nothing.

### Live preview (`packages/web/components/MergePreview.tsx`)

- Renders a real one-page PDF (via the existing `renderOne` path) for the **first merged row** — or a placeholder row of the field names (`{Name}` → "Name") when no list is loaded — then rasterises page 1 in the browser with `pdfjs-dist` (already a dependency; the worker file is copied to `public/` at predev/prebuild alongside the existing MediaPipe copy step, or served via module URL) onto a `<canvas>`, scaled to fit its container at device pixel ratio.
- Debounced 300 ms after any design/list change; a subtle spinner overlay while re-rendering; renders are sequenced so a stale render never overwrites a newer one.
- Because the preview *is* the PDF, it's WYSIWYG by construction — no duplicated layout math.
- Placement: top of the Design card on mobile; side-by-side with the controls on `lg+`.

### Design panel UI (`packages/web/components/DesignPanel.tsx`)

Shared across all four tools, embedded in each tool's existing Design card behind a "Customise" disclosure (closed by default — the tools stay one-click simple):

- **Size:** per-tool preset `Segmented` + a "Custom" option revealing width/height inputs in **mm** (converted ×2.83465 to pt). Presets — certificate: A4 landscape (default), A4 portrait, A5 landscape, US Letter landscape; badge: 4×3 in (default), A6 landscape; place card: current default, custom; ticket: current default, custom.
- **Text styles:** one row per slot the current layout exposes (label from the slot, e.g. "Recipient"): font select (curated + uploaded), size (pt, number input), tracking (pt, 0.1 steps, may be negative), colour swatch, outline toggle revealing outline colour + width.
- **Border:** none / single / double, colour, thickness, inset.
- **Dividers:** list with add/remove; each row has vertical position (%), width (%), thickness, colour.
- **Persistence:** overrides per tool in `localStorage` `ee.design.<toolId>` (`{ v: 1, … }`, parsed defensively; unknown versions discarded). "Reset design" button clears them.
- House style per the anti-vibecode skill: one accent, flat buttons, sentence case, 44 px targets on mobile, `Segmented` reuse.

### Tool client wiring

Each of `CertificateClient`, `BadgeClient`, `PlaceCardClient`, `TicketClient`:

- computes `spec = applyDesign(layoutSpec, overrides)` (memoised) — downloads and preview both consume the same final spec;
- mounts `MergePreview` and `DesignPanel`;
- passes the font pool loader so downloads embed exactly the fonts in use.

Layout factories in core (`certificate.ts`, `badge.ts`, `placecard.ts`, `ticket.ts`) tag their text elements with `slot` ids; no other layout changes.

### Out of scope

Drag-and-drop element repositioning, logo/image upload, saving designs as shareable files, persisting uploaded fonts across sessions, new layouts.

---

## Testing

- **Core:** `design.test.ts` — proportional rescale (positions, image/qr sizes, text scaling, absolute size overrides), slot style merge, `stroke: null` removal, border single/double injection geometry, divider injection; layout factories emit expected slots.
- **Renderer:** extend `merge-render.test.ts` — letter-spacing alignment width math; stroke operators present in the content stream; rect/line drawn with n-up offsets; font pool falls back cleanly when a `fontId` has no bytes.
- **Shortener:** route test with mocked `fetch` covering success, custom-name success, all four error codes, invalid input 400s; client-side name/url validation unit tests.
- **Nav:** disabled-state logic unit-tested where practical (Navigation API mocked); manual smoke elsewhere.
- Existing suites must stay green (`npx vitest run` in core and web); core rebuild before web consumes new exports.

## Risks

- **is.gd availability/rate limits** — accepted; errors surface honestly.
- **pdfjs in the browser** needs its worker asset; if the copy-to-public approach fights Turbopack, fall back to `import.meta.url` worker resolution. Isolated inside `MergePreview`.
- **Font file weight** — seven families ≈ 1.5–2.5 MB in `public/`; fetched lazily only when the designer/preview loads, cached per session.
- **Text stroke via raw operators** is the least-trodden pdf-lib path; the renderer test asserts operator emission, and the preview makes any visual defect immediately obvious.
