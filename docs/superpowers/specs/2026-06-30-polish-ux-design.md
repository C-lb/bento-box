# Plan 5 — Polish + UX (navigation, status, error prevention/recovery) design

Date: 2026-06-30
Status: approved (design), pending implementation plan

## Goal

Tighten the existing event-editor app: fix the fragile env-loading setup, clear
accumulated cosmetic debt, and — the centerpiece — give every tool consistent
navigation, system-status visibility, and error prevention + recovery, grounded
in Nielsen's usability heuristics (#1 visibility of system status, #3 user
control, #5 error prevention, #9 help users recognize/recover from errors).

No new features. This is polish on the three shipped tools (Photo sorter, Audio
transcriber, Headshot studio) + the shared shell.

## Bucket 1 — Env loading (kill the symlink hack)

**Problem:** Next loads `.env` from its own cwd (`packages/web`), not the repo
root where the real keys live. The current workaround is a hand-made symlink
`packages/web/.env -> ../../.env` (on-disk only, not committed), plus a stale
`packages/web/.env.local.bak`. A fresh checkout has neither and silently runs
without keys.

**Fix:**
- In `packages/web/next.config` add, before the config object:
  `import { loadEnvConfig } from "@next/env"; loadEnvConfig(resolve(__dirname, "../.."));`
  `@next/env` is already installed (it ships with Next). This populates
  `process.env` from the root `.env`/`.env.local` using Next's own loader, for
  dev, build, and start, regardless of cwd. Next's later internal load of
  `packages/web` env does not override already-set vars, so root wins.
- Delete the `packages/web/.env` symlink and `packages/web/.env.local.bak`.
- Confirm root `.env` is gitignored (it is) and add a one-line note to the setup
  README: "All keys live in the repo-root `.env`."

**Verification:** a server route reading a root-only env var returns it after a
clean `npm run dev` with no symlink present; `npm run build` stays clean.

## Bucket 2 — Sorter UX correctness (folds into Bucket 4's sorter work)

- `SorterClient.scan()` wrapped in try/finally so `busy` always resets — a thrown
  POST can no longer strand the Scan button disabled.
- Errored photos render in the grid (today the `:106` guard hides them) with
  their `errorMessage` surfaced.

These are implemented together with the sorter status/recovery work in Bucket 4
so the sorter client is touched once.

## Bucket 3 — Cosmetic cleanups

- Raw `text-[#4ade80]` (sorter connected state) → `text-success` (the
  `success: "#16a34a"` token already exists in `tailwind.config.ts`).
- Remove the dead `getDbPathLabel` fallback path in `packages/core/src/migrate.ts`
  (the root migrate script always exports an absolute `EE_DB_PATH`).
- Replace the `f.id!` non-null assertions in `drive.ts` `listFolders`/`listImages`
  with a proper filter (`.filter((f): f is ... => !!f.id)`), so a file without an
  id is skipped rather than asserted.
- Transcribe doc-name derivation (`core/transcription.ts:74`,
  `row.originalFilename.replace(/\.[^.]+$/, "") + " transcript"`): extract the
  base-name logic into a pure helper in `core/transcribe.ts` (so it's testable)
  that strips a single trailing extension **only when it is a recognized
  audio/video extension** (e.g. mp3, m4a, wav, mp4, mov, ...); otherwise keep the
  name unchanged. Cases: `recording.m4a` → `recording`; `notes.txt` →
  `notes.txt` (not a media ext); `talk.mp3.bak` → `talk.mp3.bak` (`.bak` not
  media). TDD the helper.
- Remove the `offsets[i] ?? i * 0` no-op at `core/transcribe.ts:35` → `?? 0`
  (or just `offsets[i] ?? 0`).

## Bucket 4 — Navigation, status visibility, error prevention & recovery

This is the centerpiece. Applies to all three tools + the shared shell.

### Icons
Add `lucide-react` (Feather-style, tree-shakeable, per-icon imports). Used for
nav and status across the app. No other icon source; do not hand-roll SVGs.

### Navigation (#3 user control)
- Replace the minimal `layout.tsx` header with a shared `Nav` **client**
  component (`"use client"`, uses `usePathname` for active-route highlight). Five
  destinations, each an icon + label: Home (`/`), Photo sorter (`/sorter`), Audio
  transcriber (`/transcribe`), Headshot studio (`/studio`), Settings
  (`/settings`). Active route gets the accent treatment; the rest are neutral.
  Present on every page, so every function is reachable from anywhere.
- In-flow back/correct: the multi-step Studio flow gets a "Start over" reset that
  clears selection back to step 1. Single-page tools rely on the persistent nav +
  browser back. No redundant per-page back arrows.

### Visibility of status (#1)
- `components/StatusBadge.tsx` — presentational. Props `{ tone: "idle" | "active"
  | "success" | "error", label: string }`. Renders a lucide icon by tone
  (`Loader2` spinning for active, `CheckCircle2` success, `AlertCircle` error,
  `Circle` idle) + the label in the matching semantic colour (success/danger
  tokens; active = accent; idle = muted). One component, used by all tools.
- `lib/status.ts` (web, pure, no node deps so it's client-importable and
  vitest-testable) — three mapping helpers turning a tool's raw status string
  into `{ tone, label }`:
  - `jobStatusView(status)`: scanning/heuristics/ranking → active (with a
    human label like "Scanning", "Ranking"); done → success "Done"; error →
    error "Failed".
  - `transcriptionStatusView(status)`: uploading/transcribing/summarizing/
    creating_doc → active; done → success; error → error.
  - `headshotStatusView(status)`: rendering → active "Rendering"; done →
    success "Done"; error → error "Failed".
  Each tool renders `<StatusBadge {...view(status)} />` prominently in its
  polling UI. These helpers are TDD'd.
- Per-item status: sorter grid photos show a small tone icon for their stage
  (scored / rejected / error); studio gallery items show their status badge.

### Error prevention (#5)
- Standardize "disabled until valid" WITH a stated reason: under a disabled
  primary action, show muted helper text saying why (e.g. "Pick a folder first",
  "Choose a photo first", "Add an audio file first"). No silently dead buttons.
- Double-submit guard via the `busy` state on every primary action (the sorter
  try/finally fix from Bucket 2 standardizes this).

### Error recovery (#9)
Every error state shows the message via `StatusBadge` (error tone) PLUS recovery
actions — no dead ends. Both retry-in-place and start-over:
- **Sorter:** errored job → "Scan again" re-POSTs `/api/sorter/jobs` with the
  still-known `folderId`; "Start over" clears job + selection.
- **Studio:** errored render → "Try again" re-POSTs `/api/studio/headshots` with
  the still-in-state `driveFileId`/`frameId`/`name`/`title`; "Start over" resets
  to step 1.
- **Transcriber:** the client no longer holds the uploaded file, so in-place
  retry needs the server. Add `POST /api/transcribe/[id]/retry` → re-invokes
  `startTranscription(db, id)` on the existing on-disk upload
  (`source_upload_path`), resetting status to `transcribing`. Errored
  transcription → "Try again" hits that route; "Start over" returns to the
  upload step.

### Landing copy fix
The landing Studio `ToolCard` still says "Drop a photo into a Canva brand
template" — update to reflect the shipped local renderer (e.g. "Turn a Drive
photo into a branded headshot").

## Architecture / new + changed files

New (web):
- `components/Nav.tsx` — client nav with active highlight + lucide icons.
- `components/StatusBadge.tsx` — presentational status pill.
- `lib/status.ts` — pure status→{tone,label} helpers (TDD).
- `app/api/transcribe/[id]/retry/route.ts` — transcriber retry.

Changed (web):
- `app/layout.tsx` — render `<Nav/>` instead of the inline header.
- `app/page.tsx` / `components/ToolCard.tsx` usage — Studio card copy.
- `app/sorter/SorterClient.tsx` — try/finally, StatusBadge, errored-photo grid,
  retry/reset, disabled-reason.
- `app/transcribe/*Client.tsx` — StatusBadge, retry/reset, disabled-reason.
- `app/studio/StudioClient.tsx` — StatusBadge, retry/start-over, disabled-reason.
- `app/sorter/page.tsx` connected-state class `text-[#4ade80]` → `text-success`.
- `lib/google/drive.ts` — drop `f.id!` assertions.
- `next.config` — `loadEnvConfig` root.

Changed (core):
- `migrate.ts` — drop dead `getDbPathLabel` fallback.
- `transcribe.ts` — new pure doc-base-name helper (TDD) + `offsets ?? 0` no-op
  removal (line 35).
- `transcription.ts` — call the doc-base-name helper at line 74.

## Testing

- `lib/status.ts` helpers: unit tests for each status → {tone,label} (TDD).
- Doc-name strip: unit test the `talk.mp3.bak` and normal cases (TDD, pure).
- Transcriber retry route: the pure precondition (re-run on existing upload)
  verified via the existing `startTranscription` path; route is thin glue.
- UI components (Nav, StatusBadge, the client changes): verified via
  `npm run build` (clean, all routes/pages in manifest) + reasoning/visual check,
  consistent with how the existing tool UIs were verified (no RTL in the repo).
- Both suites stay green (core 45 / web 30 baseline, plus the new unit tests);
  `npm run build` clean.

## Out of scope

- Any new tool or feature; Canva renderer (that's Plan 4b).
- Adding a test renderer / RTL harness for React components.
- Auth on routes (single-user local threat model unchanged).
- Persisting "recent renders"/job history beyond what already exists.

## Decomposition (for the plan)

Roughly: (1) env loading; (2) cosmetic core/web cleanups incl. TDD doc-name fix;
(3) shared primitives — lucide-react + StatusBadge + status.ts (TDD) + Nav +
layout + landing copy; (4) sorter integration; (5) transcriber integration +
retry route; (6) studio integration. Shared primitives (3) land before the
per-tool integrations (4-6).
