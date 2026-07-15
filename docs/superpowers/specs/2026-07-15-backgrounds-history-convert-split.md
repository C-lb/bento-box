# Backgrounds upload, history visibility, custom-canvas remove, convert split — design + plan

Date: 2026-07-15. Approved by Caleb (design conversation, with one amendment: split
link-to-audio out of /convert into its own card).

Four items, one wave:

1. "See past …" visible on every tool (bug)
2. Custom-canvas background removal + asset GC (bug — the "comes back after reload" repro)
3. Certificate/ticket background upload + full-cover preset backgrounds (feature)
4. Split /convert into file conversion (/convert) and audio-from-link (/audio) (feature)

## 1. "See past …" visible on every tool

**Problem.** `PastMergeOutputs` returns `null` when history is empty, so certificate,
badge, ticket, and place card show no history affordance until the first download.
`QrClient` gates its history card on `history.length > 0` the same way. The jobDir
tools (convert, resize, splice, …) always show a "See past" button — inconsistent.

**Fix.**
- `components/PastMergeOutputs.tsx`: drop the `items.length === 0 → null` early
  return. Render the card always; when empty show muted copy
  "Past {noun} appear here after you download." and hide the "Clear all" button.
- `app/qr/QrClient.tsx`: remove the `history.length > 0` wrapper; same empty copy
  ("Past QR codes appear here after you download."), hide Clear when empty.
- No changes to jobDir tools (already right).

**Verify.** Fresh profile: certificate and qr pages show the empty history card.
After a download the row appears. Existing tests keep passing.

## 2. Custom-canvas background removal + asset GC

**Problem.** The F3 custom editor has "Upload background" / "Replace background" but
no remove. `CustomDesign.background` persists in `ee.customDesign.<tool>` and the
bytes in the shared `ee-design-assets` IndexedDB store, so a background you can't
remove "comes back" whenever you return to Custom. Replacing also orphans the old
bytes forever. (The built-in-layout None path was live-verified clean — select →
None → reload stays removed.)

**Fix.**
- `components/CustomDesignEditor.tsx`: when `p.design.background` is set, render a
  "Remove background" button next to Replace. It calls
  `p.onChange({ ...p.design, background: null })` and reports the removed assetId
  via a new optional prop `onAssetRemoved(assetId)`.
- Asset GC, in the owning clients (`CertificateClient`, `MergeToolClient`), shared
  helper `lib/design-assets.ts → gcAssetIfUnreferenced(assetId)`:
  delete the asset from IndexedDB unless it is still referenced by
  (a) any saved design preset (`ee.designPresets.*`, both tools' lists — presets
  reference assets by id across sessions), or
  (b) any persisted custom design (`ee.customDesign.*`).
  Scan is cheap: parse the handful of localStorage keys, collect assetIds.
- Call the same GC on **replace** (setBackground already knows the previous
  assetId) and on background removal.
- Keep `withBackground`'s null-is-noop semantics untouched (documented seam);
  removal goes through the design object, not withBackground.

**Verify.** Unit test for `gcAssetIfUnreferenced` (referenced → kept, orphaned →
deleted). Manual: upload bg in Custom, Remove, leave + re-enter Custom, reload —
gone; IndexedDB row gone; a preset saved with that bg still applies.

## 3. Background upload + full-cover presets (certificate + ticket)

**Problem.** Built-in layouts only offer four subtle line-rule bundled backgrounds.
No way to bring your own; no full-cover designs. (Renderer already stretches
`DocumentSpec.background` to the full page, and the custom canvas already accepts
PNG/JPG/PDF uploads — we reuse both.)

**Fix.**
- **Type.** `DesignOverrides.background` widens from `{ id } | null` to
  `{ id } | { assetId, kind: "png" | "jpg" | "pdf" } | null` (core `design.ts`).
  `sanitizeDesignOverrides` accepts both shapes (assetId string ≤ 200 chars, kind
  enum). `withBackground` unchanged.
- **Panel.** `DesignPanel` Background section gains an "Upload…" tile at the end of
  the grid (file input, `accept="image/png,image/jpeg,application/pdf"`, reuse
  `readBackgroundUpload` from lib/custom-upload). On pick: `putAsset` into the
  shared IndexedDB store, set `background: { assetId, kind }`. When an uploaded
  background is selected the tile shows "Your upload" state; None clears either
  kind (and GCs the uploaded asset via item 2's helper).
- **Resolution.** The clients' existing `loadBackgroundById` effect generalises to
  a `loadOverridesBackground(bg)` helper in `lib/design-backgrounds.ts`:
  `{ id }` → fetch bundled file (existing memo cache); `{ assetId, kind }` →
  `getAsset` + `assetSrc` (per-assetId memo). Same effect shape, same
  re-resolve-at-download-time path. Missing asset (cleared device) → treated as no
  background + the DesignPanel shows the existing amber "no longer stored on this
  device" degrade line.
- **Preset capture.** No changes needed — presets store `overrides` verbatim, and
  the apply-time missing-asset note in DesignPresetBar extends to design-kind
  presets whose overrides.background has an assetId that no longer resolves.
- **Full-cover bundled presets.** Extend `scripts/gen-backgrounds.mjs` with four
  new vector designs per tool (certificate: framed wash, corner flourishes,
  diagonal band, seal zone; ticket: full-bleed duotone, side stripe wash, dotted
  frame, banner band). Restrained, one accent, anti-vibecode. Regenerate
  `public/backgrounds/<tool>/` (PDF + PNG thumb each) and append registry entries
  in `lib/design-backgrounds.ts`.

**Verify.** Core: sanitizer round-trips both background shapes. Web: upload a PNG on
/certificate → preview covers the page → download PDF contains it → None removes and
survives reload. New bundled entries render in the picker with thumbnails.

## 4. Convert split: /convert (files) + /audio (link)

**Problem.** PDF↔PNG both work but are invisible: /convert opens in Link mode
defaulting to mp3, reads as a downloader, and outputs only appear after picking a
file. Caleb: separate file conversion from link/video-to-mp3, new card + thumbnail.

**Fix.**
- **/convert — "Convert files"** becomes file-only. Remove the Link|File segmented
  control, URL input, and title-prefill path from `ConvertClient`. Add a
  supported-conversions hint above the drop zone:
  "Images ↔ PDF · HEIC → PNG/JPG · PDF → images · audio/video files → MP3/WAV/M4A".
  File input gets an `accept` list built from the format matrix. Card copy in
  `components/tools.ts` trimmed to file conversions; drop link/youtube tags.
- **New /audio — "Audio from a link"**: new route + client carrying the current
  link flow verbatim (URL input, title prefill, ndjson progress stream, yt-dlp
  gating via the same `ytDlp` prop plumbing as /convert's page.tsx). Posts to the
  existing `/api/convert/url` endpoint; the endpoint gains an optional
  `tool: "audio"` run-dir label so its history records under `audio` instead of
  `convert` (default stays `convert` for back-compat during rollout).
  Output formats: mp3/wav/m4a only.
- **Cards.** New registry entry `{ id: "audio", href: "/audio", title: "Audio from
  a link", Icon: Music, defaultGroups: ["media"], tags: [audio, mp3, wav, m4a,
  youtube, link, download, extract audio] }`. /convert keeps ArrowRightLeft.
- **History.** Both pages keep a PastRuns button: /convert → tool "convert",
  /audio → tool "audio".

**Verify.** /convert: drop a PDF → PNG/JPG offered → converts; drop a PNG → PDF
offered → converts; no URL affordance remains. /audio: link → mp3 works, history
records under audio. Home shell shows both cards, search finds "pdf to png" →
Convert files and "youtube" → Audio from a link.

## Execution plan

Subagent-driven, one reviewed task per item, in this order (2 depends on nothing,
3 depends on 2's GC helper; 1 and 4 independent):

- **T1 — See past empty states.** PastMergeOutputs + QrClient. Tests: none new
  (visual); run existing suite.
- **T2 — Custom canvas remove + GC.** CustomDesignEditor button, `gcAssetIfUnreferenced`
  in lib/design-assets.ts + unit tests, client wiring (certificate + MergeToolClient).
- **T3 — Background upload + resolution + sanitizer.** Core type + sanitizer +
  tests, DesignPanel upload tile, `loadOverridesBackground`, client effects +
  download paths, None/GC wiring.
- **T4 — Full-cover bundled backgrounds.** gen-backgrounds.mjs designs, regenerate
  assets, registry entries.
- **T5 — Convert split.** ConvertClient slim-down, new /audio route + client,
  tools.ts cards, /api/convert/url tool label.
- **T6 — Verify + ship.** `npm run typecheck` + test suites (core, web), Playwright
  smoke against dev server (certificate upload-bg round trip, custom remove, /convert
  pdf→png, /audio gating), commit(s) + push to main.

Constraints carried: core imports via subpaths + rebuild before web typecheck;
Turbopack extensionless imports gotcha; no new webfont glyphs (lucide SVG only);
anti-vibecode styling for any new UI.
