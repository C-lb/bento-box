# Bento Box rename + audio/convert thumbnail fix

## Context

Two small, independent fixes bundled as one quick spec (first of four specs from the same request — HTML export, stamp preview editor, and a new Workflow tab are separate specs to follow):

1. The app is branded "Bento" in several places but should read "Bento Box" everywhere.
2. On the tool discovery grid, each card has an animated hover thumbnail (`packages/web/components/tool-illustrations.tsx`), separate from its small lucide icon. The `/convert` tool currently owns an illustration that's actually a "link → mp3" visual (a link chip morphing into an audio waveform) — that content belongs to `/audio` ("Audio from a link"), which currently has no thumbnail at all and renders an empty grey box. `/convert` needs its own new thumbnail.

## Changes

### 1. Rename "Bento" → "Bento Box"

Text-only change, no logo/image assets involved. iOS (`Info.plist`) and mobile (`capacitor.config.ts`) already say "Bento Box" — untouched. Docs under `docs/` are non-shipping — untouched.

| File | Line(s) | Change |
|---|---|---|
| `packages/web/app/layout.tsx` | 7 | `metadata.title: "Bento"` → `"Bento Box"` |
| `packages/web/app/login/page.tsx` | 4 | `metadata.title: "Sign in - Bento"` → `"Sign in - Bento Box"` |
| `packages/web/app/login/LoginClient.tsx` | 36 | `"Sign in to Bento"` → `"Sign in to Bento Box"` |
| `packages/web/components/Nav.tsx` | 117 (+ comment at 108) | Nav logo text `"Bento"` → `"Bento Box"` |
| `packages/desktop/package.json` | 5, 21 | `description: "Bento desktop app"` → `"Bento Box desktop app"`; `productName: "Bento"` → `"Bento Box"` |

### 2. Thumbnail fix

In `packages/web/components/tool-illustrations.tsx`:

- Rename the existing `ConvertIllus()` function to `AudioIllus()`. No internal changes — it already correctly depicts a link becoming an mp3/waveform. Reassign the `ILLUSTRATIONS` map entry from `convert: <ConvertIllus />` to `audio: <AudioIllus />`.
- Add a new `ConvertIllus()` for the `convert:` map entry: a "file format swap" visual — two file-shaped tiles side by side, each carrying a small format-label badge (e.g. `PNG` and `JPG`, generic enough to read as "any format"), connected by the same left-to-right accent arrow glyph already used in `AudioIllus`. On hover, the right tile's badge label crossfades to a second format (e.g. `JPG` → `MP4`) to read as "convert between formats," using the same `motion-safe:group-hover:*` transition pattern, `TILE`/`TILE2` greys, and single `bg-accent` touch as every other illustration in this file. No new colors, no new animation primitives.
- No changes to `ToolCard.tsx`, `ToolGrid.tsx`, or `tools.ts` — the `Icon` field there is unrelated and untouched, and the `ILLUSTRATIONS` lookup is purely by tool `id`.

## Testing

- Visual check: hover both `/audio` and `/convert` cards on the discovery grid, confirm each shows its own distinct animated thumbnail (no more empty box on audio).
- Grep for remaining bare `"Bento"` (not followed by `" Box"`) across `packages/web`, `packages/desktop`, to confirm no stray occurrence was missed.
