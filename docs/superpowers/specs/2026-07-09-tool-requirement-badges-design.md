# Tool requirement badges — design

**Date:** 2026-07-09
**Status:** Approved (design), pending combined spec+plan review
**Product:** Bento (event-editor)

## Problem

Downloading the Bento dmg gives you the app, but several tools are inert until
the machine is configured: some need an API key in the per-user `.env`
(`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, Google/Canva OAuth client credentials),
and one needs an external binary installed (LibreOffice for the slide slicer).
Today a user only discovers this by opening the tool and watching it fail. There
is no at-a-glance signal on the tool grid that a tool can't run yet, and no
direct path to fix it.

## Goal

On the tool grid, any tool whose hard requirements aren't met on this machine is
**dimmed and non-clickable**, with an **amber exclamation badge** in the card's
top-right corner. The badge:

- shows a tooltip on desktop hover, e.g. *"Feature not available: needs Groq API key"* or *"Feature not available: needs LibreOffice"*;
- is the only interactive element on a blocked card;
- on click/tap, navigates to the exact Settings section that fixes it
  (`/settings#api-keys` for a missing key, `/settings#dependencies` for a
  missing package), which briefly highlights so it's obvious where to look.

Detection is a **real runtime check** — the badge reflects what is actually
configured/installed right now, not a static guess.

## Non-goals

- No tool-page banner. Card badge only (deliberate scope call).
- No toast library. Reuse the repo's existing inline-message patterns.
- No change to how keys are saved. Keys still take effect after relaunch
  (existing behavior); the badge clears on next launch once a key is saved.
- OAuth *connection* state (Google/Canva token present) is **not** a blocking
  requirement. Having the client credentials configured is enough to unblock the
  card; the in-tool "connect" flow still handles token acquisition at runtime.

## Architecture

Four small pieces, each reusing existing server logic.

### 1. Requirement metadata (`packages/web/components/tools.ts`)

Add one optional field to the `Tool` type:

```ts
requires?: { keys?: ConnectionId[]; deps?: DepId[] };
```

- `ConnectionId` (`"google" | "anthropic" | "canva" | "groq"`) is imported from
  `@event-editor/core` settings (already the source of truth via `getConnections`).
- `DepId` (`"ffmpeg" | "ytdlp" | "libreoffice"`) comes from `lib/deps.ts`
  (export the union if it isn't already exported).

Only **hard** requirements are listed — a requirement that makes the tool
completely unusable. Bundled deps (`ffmpeg` via `ffmpeg-static`, `sharp`) are
always present, so tools that only need those carry no `requires` and are never
blocked.

Initial per-tool annotations (final list confirmed against each tool's code
during planning):

| Tool | `requires` | Rationale |
|------|-----------|-----------|
| sorter (Rank Drive photos) | `keys: ["google","anthropic"]` | Reads Drive, ranks with Claude |
| studio (Headshot Studio) | `keys: ["google","canva"]` | Drive source + Canva renderer |
| transcribe | `keys: ["groq","anthropic","google"]` | Whisper + summary + Drive |
| slice (Slide slicer) | `keys: ["anthropic"], deps: ["libreoffice"]` | soffice conversion + Claude |
| convert, video, splice, resize, qr, heic, pdf, cutout | *(none)* | Bundled/client-only |

**convert / yt-dlp exception (decision to confirm):** convert does file→mp3 with
bundled ffmpeg (works with no config) and link→mp3 with yt-dlp (needs the managed
download). Because block-until-ready can't tell which mode the user wants from
the grid, blocking convert on a missing yt-dlp would wrongly disable the
file-mode that works fine. So **convert is left unblocked**; its existing in-tool
prompt (Settings → Dependencies) continues to handle the yt-dlp download. Net
effect: yt-dlp is the one "needs download" case that surfaces inside the tool
rather than as a grid badge. Flagged here for veto during review.

### 2. Detection endpoint (`packages/web/app/api/health/route.ts`)

Extend the existing `GET /api/health` to also return key presence, reusing
`getConnections()`:

```jsonc
{
  "ok": true,
  "deps": [{ "id": "libreoffice", "ready": false, "version": null }],
  "keys": [{ "id": "groq", "configured": false }, ...]
}
```

`getConnections()` already checks `process.env` for each connection's required
vars. No new detection logic; the route just maps its output.

### 3. Readiness resolver (`packages/web/components/tool-readiness.ts`, new)

A pure helper, unit-testable in isolation:

```ts
type Health = { deps: {id:DepId;ready:boolean}[]; keys: {id:ConnectionId;configured:boolean}[] };
type Missing = { keys: ConnectionId[]; deps: DepId[] };

function toolReadiness(tool: Tool, health: Health): { ready: boolean; missing: Missing };
```

Plus a label map (`groq → "Groq API key"`, `libreoffice → "LibreOffice"`, …) and
a tooltip builder that produces the `"Feature not available: needs X"` string,
listing every missing item and choosing the deep-link target: `#api-keys` if any
key is missing, else `#dependencies`.

### 4. UI

- **Grid data (`ToolGrid.tsx`)** — fetch `/api/health` once on mount into state.
  While `health === null` (loading), render every card **unblocked** to avoid an
  "everything's broken" flash. Pass the resolved readiness to each `ToolCard`.
- **`ToolCard.tsx`** — accept a `readiness` prop. When not ready:
  - wrap the body in a non-navigating container (no `<Link>` / `aria-disabled`,
    `cursor-not-allowed`) and dim it (reduced opacity on the illustration/title/body);
  - keep the top-right `CardMenu` (fav/group) live;
  - overlay an amber badge (Lucide `TriangleAlert`, flat fill, dim `ring-1`
    stroke — cloned from `ConnectionPills` amber styling, **no new webfont
    glyphs**) that is a `<Link>` to the deep-link target, with the tooltip text
    as its accessible label and desktop `title`/hover treatment.
- **Settings anchors (`settings/page.tsx`)** — add `id="api-keys"` to the "API
  keys" `<h2>` and `id="dependencies"` to the "Dependencies" `<h2>`. A small
  client effect reads `location.hash` on load and applies a brief highlight ring
  to the targeted section.

## Data flow

```
grid mount → GET /api/health → { deps, keys }
                                    │
        each tool ──► toolReadiness(tool, health) ──► { ready, missing }
                                    │
                 ready? render normal card (Link active)
                 not ready? dim body + amber badge → /settings#api-keys|#dependencies
```

## House style

- Amber (`amber-50 / amber-700 / amber-600/20` ring) for the needs-setup state,
  matching `ConnectionPills`. Never a red/danger tone — this is a warning, not an error.
- Flat, no shine (per house button rules). Dim `ring-1` stroke.
- Inline Lucide SVG icon; no `ti-*` webfont glyphs.
- Sentence-case copy, no em dashes: "Feature not available: needs Groq API key".

## Error handling

- `/api/health` fetch fails → treat as **all ready** (fail-open). A transient
  health error should never block every tool. Log to console; no user-facing error.
- A tool references an unknown key/dep id → resolver ignores it (treats as
  satisfied) so a typo can't permanently block a tool.

## Testing

- **Unit** (`tool-readiness.test.ts`): ready when all present; blocked when a key
  missing; blocked when a dep missing; blocked when both; unknown id ignored;
  tooltip text and deep-link target correct for each missing-combination.
- **Endpoint**: `/api/health` returns a `keys` array with one entry per
  connection and correct `configured` booleans given a stubbed env.
- **Manual (packaged app)**: with an empty `.env`, sorter/studio/transcribe/slice
  show badges; clicking a badge lands on the highlighted Settings section; after
  filling keys and relaunch, badges clear; convert stays usable throughout.

## Files touched

- `packages/web/components/tools.ts` — `requires` field + annotations
- `packages/web/lib/deps.ts` — export `DepId` union if not already
- `packages/web/app/api/health/route.ts` — add `keys`
- `packages/web/components/tool-readiness.ts` — new resolver + labels (+ test)
- `packages/web/components/ToolGrid.tsx` — fetch health, pass readiness
- `packages/web/components/ToolCard.tsx` — blocked state + badge
- `packages/web/app/settings/page.tsx` — anchor ids + highlight-on-hash
