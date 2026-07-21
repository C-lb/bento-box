# Workflow tab: chain tools via natural-language instructions

Date: 2026-07-21
Package: `packages/web` (+ `packages/core` for schema/types)
Status: approved, ready to plan

## Problem

Bento Box has 18 standalone tools. Real event-prep work often chains several
of them (slice a deck by speaker, stamp each PDF confidential, convert each to
HTML) but today that means manually downloading from one tool and re-uploading
into the next. There is no way to describe a multi-tool job once and have it
run end to end, or to re-run a known chain against new input.

This is spec 4 of 4 for the current milestone (specs 1-3: rename/thumbnails,
HTML export, stamp preview editor — all shipped).

## Goals

1. A user types a free-text goal ("slice this deck by speaker, stamp each PDF
   confidential, convert to HTML") and gets back a proposed, ordered chain of
   tool steps with inferred parameters.
2. The proposed chain renders as an editable card list: drag-reorder, edit a
   step's instruction (re-synthesizes that step's params), add a step from a
   tool picker, remove a step.
3. Chains are strict linear pipelines — step N's output feeds step N+1's
   input. No branching/fan-out in this version.
4. A confirmed chain can be run, and saved as a named, re-runnable workflow.
   Re-running prompts only for fresh step-1 input; every other step replays
   its saved params.
5. Only tools whose input/output types are compatible can be adjacent in a
   chain — enforced identically whether a step came from the AI planner or
   manual add.

Non-goals:
- No DAG/branching execution.
- No chaining support for `cutout`, `certificate`, `badge`, `place-card`,
  `ticket` — these are pure client-side canvas/mail-merge tools with no
  server processing route today. Giving them one is a separate future spec.
- No re-confirmation of every step on re-run — only step 1's input changes.
- No new capability for any individual tool. This spec only orchestrates
  existing tool logic.

## Design

### 1. Tool participation and the type system

Every chainable tool gets a declared `inputKind` / `outputKind` from a fixed
set:

| Kind | Meaning |
|------|---------|
| `file` | a single binary artifact (image, pdf, audio, video) |
| `files` | a batch of binary artifacts |
| `url-text` | a URL or short text string |
| `drive-ranked-list` | Drive file IDs + scores (sorter's output) |
| `doc` | a Google Doc URL + optional summary text (transcribe's output) |
| `headshot-batch` | Drive/Canva image batch (studio's output) |

Chainable tools and their kinds:

| Tool | inputKind | outputKind | Notes |
|------|-----------|------------|-------|
| `convert` | `file` | `file` | format change; also handles audio-from-link (`url-text` → `file` via `/api/convert/url`) |
| `heic` | `file` | `file` | |
| `resize` | `file` | `file` | |
| `pdf` | `file` | `file` | merge/split/compress. `inputKind` is `file`-only in v1 — `StepKind` has no "file or files" union, so a batch (e.g. slice's output) can't chain directly into pdf's merge; pdf still works standalone or after any single-file step. Revisit if batch-into-merge chaining is wanted later. |
| `video` | `file` | `file` | |
| `splice` | `files` | `file` | trim/join |
| `slice` | `file` | `files` | deck → PDF pages, already multi-step internally (convert→segment→export) |
| `shorten` | `url-text` | `url-text` | |
| `qr` | `url-text` | `file` | needs a new server route (today client-only via the `qrcode` package; that package runs fine in Node, so this is a thin wrapper, not new logic) |
| `sorter` | (Drive folder, no upstream kind) | `drive-ranked-list` | async job |
| `transcribe` | `file` | `doc` | async job |
| `studio` | (Drive photo + name/title rows) | `headshot-batch` | async job |

A step can only be placed immediately after another step if its `inputKind`
equals the prior step's `outputKind`. `sorter`, `transcribe`, `studio` have
no matching consumer or producer among these kinds today — they're valid
chain steps, but in practice each will almost always be a **standalone
single-step workflow** (their own input source, or the last step consuming
whatever produced a compatible `file`). The genuinely composable middle of
chains is the `file`/`files` set. The chain-builder UI must make this
honestly visible: after one of these three, "add step" offers no compatible
next tool, and that's expected, not a bug.

### 2. Architecture: reuse existing tool logic in-process

The engine runs server-side (Next.js API routes) and calls the same
underlying `lib/*.ts` functions each tool's own API route already calls
(`resizeImage`, `compressVideo`, `spliceClips`, `startScan`, `startTranscription`,
etc.) directly in-process. It does **not** self-call its own HTTP API routes.
This keeps all real processing logic in one place (the existing per-tool
libs) and the workflow layer as pure orchestration.

Each chainable tool gets one adapter file under
`packages/web/lib/workflow/steps/<tool>.ts` implementing:

```ts
export interface StepAdapter<Input, Params, Output> {
  inputKind: StepKind;
  outputKind: StepKind;
  paramsSchema: JSONSchema; // for structured-output param synthesis
  run(input: Input, params: Params): Promise<Output>;
}
```

Synchronous tools (`convert`, `heic`, `resize`, `pdf`, `video`, `splice`,
`slice`, `shorten`, `qr`) implement `run` as a direct async call. The three
async-job tools (`sorter`, `transcribe`, `studio`) implement `run` as
kick-off-then-poll-to-terminal-status, wrapping their existing job
infrastructure (`lib/sorter.ts`'s `startScan`, `lib/transcriber.ts`'s
`startTranscription`, `lib/batch.ts`'s `runBatch`).

### 3. Plan generation (natural language → editable chain)

Two structured-output calls via the existing `lib/anthropic.ts` client
(new file `lib/workflow/plan.ts`):

1. **Planner call** — user's free-text goal → ordered
   `{toolId, instructionText}[]`. The prompt includes the compatibility table
   so the model only proposes valid adjacent-kind sequences; the result is
   validated against the type table server-side regardless (never trust the
   model to have honored the constraint).
2. **Param synthesis call** — for each `{toolId, instructionText}`, infer that
   tool's actual params as JSON validated against its `paramsSchema` (e.g.
   resize's `{maxWidth, maxHeight, quality, format}`). Re-run whenever a
   step's instruction text is edited by hand.

### 4. Chain builder UI

New route `/workflow`. A single page:

- Free-text input + "Propose chain" button → calls the planner, renders the
  result as a vertical list of step cards.
- Each card: tool icon/name, editable instruction text (re-synthesizes
  params on blur/submit), a small params summary, remove button.
- Drag handle per card (reuse the existing drag-reorder primitive from
  Settings' group reordering). Reordering re-validates the kind chain;
  a broken adjacency renders that junction with an inline error and disables
  Run until fixed.
- "Add step" opens the existing tool picker (from the discovery shell),
  filtered to tools whose `inputKind` matches the current last step's
  `outputKind` (or, for an empty chain, any tool that doesn't require an
  upstream kind).
- "Run" button (disabled while invalid) and "Save as workflow" (name prompt).

### 5. Execution + progress

New `workflow_runs` table (mirrors the existing `tool_runs`/`jobs` shape) with
one row per run and a JSON array of per-step status
(`pending`/`running`/`done`/`error` + timestamps + output refs). A run page
polls this like the existing job-status panels and renders a step-by-step
timeline (spinner → check/cross per step).

On a step error: halt (strict linear — no partial branching to fall back to).
Prior completed steps' intermediate outputs stay in their `jobDir`-style
storage and are downloadable individually. A "Retry from here" action re-runs
only the failed step (and everything after it) against the last good
intermediate output, rather than restarting the whole chain.

### 6. Saved workflows

New `workflows` table: `id`, `name`, `steps` (JSON: `toolId` + params per
step, **excluding** step 1's input source), `createdAt`. A `/workflows` list
page follows the existing Past Runs UI convention (Run / Edit / Delete per
row). Re-running prompts only for step 1's input (file upload, Drive picker,
or URL field, depending on that tool) — every other step replays its saved
params unchanged, matching the strict-linear model (only the entry point
varies between runs).

### 7. Nav placement

"Workflow" is a fixed pinned nav item next to the Settings gear (outside the
scrolling group-pill row), since it's cross-cutting and not owned by any one
tool group. `/workflows` (the saved list) is reachable from within the
Workflow tab, not a second nav entry.

## Testing

- Unit tests per step adapter: thin wrappers around already-tested lib
  functions, so tests here check the adapter's input/output mapping and
  error propagation, not the underlying logic.
- Type-compatibility validator: exhaustive adjacency table tests (valid pairs
  pass, invalid pairs rejected, including manual-add filtering).
- Plan parser: planner/param-synthesis output validated against schemas;
  malformed/incompatible model output rejected before reaching the UI.
- Saved workflow CRUD (create/list/rename/delete).
- Execution engine: sequential success path, halt-on-error preserves prior
  outputs, retry-from-failed-step resumes correctly, async-job adapters poll
  to terminal state.
- API routes: propose, save, run, list, retry.
