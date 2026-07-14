# Headshot Studio — advanced styling (transparent bg, rim, per-line text, pan, fonts)

Date: 2026-07-14
Tool: Headshot Studio (`/studio`, local renderer)
Status: approved design → implementation plan

## Goal

Give the local headshot renderer real design control, driven by a live in-browser
preview instead of blind server round-trips:

1. **Transparent background** — export a PNG with `background alpha = 0` so the card
   drops onto any slide/colour.
2. **Text control** — three lines (Name / Title / Company); per-line **bold, size,
   letter-spacing, italic**; card-level **font family** (from the 7 bundled designer
   families), **text colour**, **uppercase**.
3. **Circle rim** — `none | solid | gradient`; width slider; solid colour picker OR
   two gradient stops + angle, with one-tap presets (incl. the magenta→purple
   reference).
4. **Photo positioning** — existing zoom (1–3×) plus **pan X/Y** by dragging the
   photo on the canvas (or sliders).
5. **Live canvas preview** — a `<canvas>` renders the exact card client-side and
   updates instantly; "Generate PNG" renders the identical layout server-side at
   1080px.

## Non-goals

- Rim on the rectangular frames (`clean-band`, `minimal-corner`) — rim is
  **circle-frame only**. Those frames keep their band/plate chrome.
- Per-line font family (decided: one typeface per card).
- Uploaded custom fonts (the designer set's 7 families only, for now).
- Canva renderer changes (Canva path is untouched; all new controls are
  local-renderer only, exactly like today's bold/italic/zoom).
- DB migration — style lives in the existing `headshots.styleJson` TEXT column.

## Decisions (locked)

| Question | Decision |
|---|---|
| Preview | Live client `<canvas>`, server renders the matching PNG |
| Text | 3 fields, per-line bold/size/spacing/italic |
| Font | One family per card (size/spacing/bold still per-line) |
| Rim | Full custom: none/solid/gradient, 2 stops + angle + presets |
| Rim scope | Circle frame only |
| Transparent bg | Toggle on all frames, default **off** |
| Company line | Optional; empty ⇒ not drawn (old 2-line cards unchanged) |

## Architecture

### The divergence problem and how we avoid it

Two renderers will draw the same card: the **client canvas** (Chromium 2D context,
`ctx.letterSpacing`, `FontFace`) and the **server** (`text-to-svg` → vector paths →
sharp). They use different text engines, so they can drift. Mitigations:

- A single **layout spec** module — `packages/web/lib/headshot-layout.ts` — exports
  pure functions computing every geometry number (photo crop box, pan clamp, text
  baselines, line widths, rim ring path/gradient coords) from `(FrameSpec,
  HeadshotStyle, texts)`. Both renderers consume it. No geometry math is duplicated.
- Both engines read the **same font files** (`/fonts/designer/<file>.ttf`) and the
  same size/tracking numbers, so glyph shapes and advances match closely.
- The preview canvas is drawn at the frame's native `canvas` px (1080) scaled by CSS
  to fit, so preview and export share one coordinate space — no px↔normalized mapping
  bugs for text. Only pan/zoom offsets are stored normalized (fraction of the photo
  box) so they're resolution-independent.

### Data model — extend `HeadshotStyle` (`core/frames.ts`)

```ts
export interface LineStyle {
  bold?: boolean;
  italic?: boolean;
  size?: number;        // px on the 1080 canvas; absent ⇒ frame default for that line
  tracking?: number;    // letter-spacing px; default 0
}

export interface RimSpec {
  mode: "solid" | "gradient";   // absence of rim ⇒ omit the whole object
  width: number;                // px on the 1080 canvas, clamped [2, 80]
  color?: string;               // #rrggbb, solid mode
  from?: string;                // #rrggbb, gradient stop 1
  to?: string;                  // #rrggbb, gradient stop 2
  angle?: number;               // degrees 0–360, gradient
}

export interface HeadshotStyle {
  // --- retained (back-compat) ---
  bold?: boolean;
  italic?: boolean;
  uppercase?: boolean;
  color?: string | null;
  zoom?: number;
  // --- new ---
  fontId?: string;              // designer-font registry id, e.g. "inter"
  companyText?: string;         // 3rd line; empty/absent ⇒ not drawn
  name?: LineStyle;             // per-line overrides
  title?: LineStyle;
  company?: LineStyle;
  offsetX?: number;             // pan, normalized -1..1 (fraction of slack)
  offsetY?: number;
  rim?: RimSpec;                // circle frame only
  transparentBg?: boolean;
}
```

Back-compat: the legacy top-level `bold/italic/uppercase/color/zoom` remain and act
as the baseline. When a per-line `LineStyle` field is present it overrides. Old
persisted cards (only top-level fields) render identically to today.

`companyText` lives in the style blob rather than a new DB column so no migration is
needed and `nameText`/`titleText` columns stay as-is.

### Font loading (server)

`text-render.ts` currently `loadSync`s one ttf at module load. Change to a small
**font pool**: `getTts(fontId, bold)` resolves the designer registry entry (bold ⇒
the `-bold` variant id if one exists), maps to a filesystem path
(`resolve(process.cwd(), "public/fonts/designer", file)` with an `EE_FONT_DIR`
override for the packaged app), `loadSync`es once, and caches by id. Great Vibes has
no bold variant → bold silently falls back to regular (and the UI disables its bold
toggles).

**Faux bold is dropped** where a real `-bold` file exists (all families except Great
Vibes) — we use the real bold face. The existing stroke-based faux bold stays only as
the Great-Vibes fallback path, if bold is somehow requested there.

### Letter-spacing (server)

`text-to-svg`'s `getPath` has no tracking. Implement it in `glyphPath`: when
`tracking` is 0 (default) use the current single-call fast path (preserves kerning).
When non-zero, lay out per character — for each glyph call `getMetrics`/`getPath` at
an accumulating `x` (advance + tracking), summing total width first so `center`
anchor can offset by `−width/2`. This mirrors merge-render's spacing approach
(`widthOf… + (n−1)*spacing`).

### Rim (server)

In `buildOverlaySvg`, when `frame.photo.shape === "circle"` and `style.rim` is set,
emit a `<circle>` stroked at the photo's centre with radius = photoRadius −
width/2 (so the ring sits on the photo edge, inward), `fill="none"`,
`stroke-width=width`. Gradient mode adds a `<linearGradient>` to `<defs>` with
`x1/y1/x2/y2` derived from `angle` (unit vector across the circle bbox) and the two
stops; solid mode strokes the flat colour. The rim is drawn **after** the photo layer
so it overlaps the photo's anti-aliased edge cleanly.

### Transparent background (server)

`renderHeadshot` builds the base with `background: frame.bg`. When
`style.transparentBg`, use `background: { r:0,g:0,b:0, alpha:0 }`. Frame chrome
(band/plate) still draws on top, so only the *empty* canvas area becomes transparent —
for the circle frame that's the whole area around the circle, which is the point.

### Client preview (`StudioClient.tsx`)

A `<PreviewCanvas>` component (new file `app/studio/PreviewCanvas.tsx`):
- `useEffect` loads the selected family (regular + bold) via `FontFace` from
  `/fonts/designer/…`, adds to `document.fonts`, then draws.
- Draws at 1080×1080 backing store, CSS-scaled to container width; `image-rendering`
  crisp.
- Photo: loads the source image (`/api/studio/drive-thumb/<id>` for Drive,
  object-URL for uploads — same URLs the current preview thumbnails use), draws it
  clipped to the circle with cover-fit + zoom + pan using the shared layout helper.
- Pan: pointer drag on the canvas updates `offsetX/offsetY` (clamped to the zoom
  slack); a subtle move cursor + "drag to reposition" hint.
- Text + rim: drawn from the same layout helper; `ctx.letterSpacing`,
  `ctx.font = \`${italic} ${weight} ${size}px "${family}"\``, gradient via
  `createLinearGradient`.
- Falls back gracefully: if the photo can't load (CORS/thumb missing) it draws a grey
  placeholder circle so text/rim tuning still works.

Preview is **local-renderer only**. For the Canva renderer and for the
`clean-band`/`minimal-corner` frames the canvas still previews (rim controls hidden
for non-circle frames).

### API validation (`route.ts` `sanitizeStyle`)

Extend to validate/clamp every new field, rejecting anything untrusted before it
reaches the SVG string:
- `fontId` — must be a known `DESIGNER_FONTS` id, else drop.
- `companyText` — string, length-capped (e.g. ≤120), same as name/title handling.
- per-line `size` — finite, clamped e.g. [12, 160]; `tracking` clamped [−20, 60];
  `bold/italic` booleans.
- `offsetX/offsetY` — finite, clamped [−1, 1].
- `rim` — `mode ∈ {solid,gradient}`; `width` clamped [2, 80]; every colour matched
  against `/^#[0-9a-fA-F]{6}$/`; `angle` finite mod 360; drop the rim entirely if
  malformed.
- `transparentBg` — boolean.
- Preserve the existing "all-default ⇒ undefined" short-circuit so we never persist
  empty style blobs.

## Files touched

| File | Change |
|---|---|
| `core/src/frames.ts` | Extend `HeadshotStyle`; add `LineStyle`, `RimSpec`; per-line default resolution helper |
| `web/lib/headshot-layout.ts` | **new** — pure geometry: crop/pan clamp, text baselines+widths, rim ring + gradient coords |
| `web/lib/text-render.ts` | Font pool by id+bold; real bold faces; letter-spacing per-glyph layout |
| `web/lib/headshot-render.ts` | Consume layout helper; rim SVG; transparent bg; 3rd line; per-line styles |
| `web/app/studio/PreviewCanvas.tsx` | **new** — live canvas preview with drag-to-pan |
| `web/app/studio/StudioClient.tsx` | Company field; per-line controls; font dropdown; rim controls; wire preview; extend `style` payload + `startOver` |
| `web/app/api/studio/headshots/route.ts` | Extend `sanitizeStyle` |
| `web/lib/headshot-layout.test.ts` | **new** — geometry unit tests |
| `web/lib/headshot-render.test.ts` (or existing) | rim/transparent/3-line render smoke |

No schema migration.

## Testing

- **Unit** (`headshot-layout.test.ts`): pan clamp at zoom 1 (no slack ⇒ offset
  ignored) and zoom 3; text width/anchor with tracking; rim radius = R − width/2;
  gradient angle → endpoints.
- **Render smoke**: render a circle card with rim gradient + transparent bg + company
  line; assert PNG has alpha=0 corners, non-empty, expected dimensions.
- **`sanitizeStyle`**: bad fontId dropped; non-hex rim colour drops rim; offsets/size
  clamped; all-default ⇒ undefined.
- **Full suite**: `npm test` (web + core) stays green; `tsc` no new errors.
- **Manual** (Caleb, needs Google OAuth): reproduce the reference — circle frame,
  magenta→purple gradient rim, name bold + company "SPARK" bold + title regular,
  transparent bg, pan the face; Generate and confirm the PNG matches the preview.

## Implementation plan (phased, subagent-driven with per-task review)

**Phase 1 — core types + layout module (no UI).**
1. Extend `HeadshotStyle` in `core/frames.ts` (+ `LineStyle`, `RimSpec`, per-line
   resolver). Rebuild core.
2. Create `headshot-layout.ts` + `headshot-layout.test.ts` (pure, fully unit-tested).

**Phase 2 — server render.**
3. `text-render.ts`: font pool + real bold + letter-spacing.
4. `headshot-render.ts`: consume layout helper, rim, transparent bg, 3rd line,
   per-line styles. Render smoke tests.

**Phase 3 — API.**
5. Extend `sanitizeStyle` + tests.

**Phase 4 — client preview + controls.**
6. `PreviewCanvas.tsx` (font load, circle photo w/ pan/zoom, text, rim).
7. `StudioClient.tsx`: company field, per-line controls, font dropdown, rim controls,
   transparent toggle, pan sliders; wire preview; extend payload + `startOver`.

**Phase 5 — verify + ship.**
8. `npm test` + `tsc` green; render a card via the real pipeline; visual check.
9. Bump desktop to 0.0.24, commit, push to main (per standing preference), then Caleb
   does the OAuth manual walk. Desktop rebuild/release only after his sign-off.

Each phase's tasks are committed atomically; a reviewer subagent gates each task.
