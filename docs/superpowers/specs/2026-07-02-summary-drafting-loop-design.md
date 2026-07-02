# Summary drafting loop: regenerate, like-to-memory, editable style, history

Date: 2026-07-02
Area: event-editor transcriber (LinkedIn / Article summary drafting)

## Problem

The transcriber generates LinkedIn and Article summary drafts from a transcript,
but the drafting loop is thin:

- Cached drafts are permanent. Once `summary_linkedin` / `summary_article` are
  written, the summary route always serves the cache, so a bad draft can never
  be regenerated and old drafts still carry the pre-fix `hashtag#` / `#`-header
  formatting.
- The "See past transcriptions" popover is capped at 5 rows, exposes no summary
  data, and offers no way to reopen a prior transcription's LinkedIn/Article
  drafts or to remove stale ones.
- There is no feedback signal: the model can't learn which drafts the user liked.
- The style examples the model imitates are hardcoded in
  `packages/core/src/summary-examples.ts` and invisible/uneditable in the app.

## Goals

1. One-off cleanup of existing cached summaries.
2. Past-transcriptions popover: show all, reopen a prior transcription (with its
   cached drafts), plus per-row "Clear drafts" and "Delete transcription".
3. Active transcription: "Regenerate all" and "Regenerate selection" (rewrite a
   highlighted span), on an editable draft with an Edit/Preview toggle.
4. A "like" smiley that commits the current draft to memory as inspiration for
   future drafts of that format.
5. A fully editable settings view of the style examples + liked drafts the model
   draws inspiration from.

Non-goals: changing the general (Google-Doc) summary pipeline; per-user accounts;
sharing examples across formats (liked/custom are per-format).

## Data model

New table (SQLite, `data/app.db`):

```
style_examples
  id         INTEGER PRIMARY KEY AUTOINCREMENT
  format     TEXT NOT NULL      -- 'linkedin' | 'article'
  kind       TEXT NOT NULL      -- 'seed' | 'custom' | 'liked'
  text       TEXT NOT NULL
  created_at INTEGER NOT NULL DEFAULT 0
```

- Migration: `CREATE TABLE IF NOT EXISTS style_examples (...)` in the `DDL` list
  of `packages/core/src/migrate.ts`.
- Seeding: a `seedStyleExamples(db)` step in `runMigrations`. For each format,
  if the table has zero rows for that format, insert the current built-in
  examples as `kind='seed'` (source of truth stays `LINKEDIN_EXAMPLES` /
  `ARTICLE_EXAMPLES` in `summary-examples.ts`). Seeding never re-runs once a
  format has any row, so user deletions stick.

Existing `transcriptions.summary_linkedin` / `summary_article` columns are reused
as the single source of the current saved draft per format.

## Example selection (what the prompt sees)

For a format, the examples passed to the prompt builder are, in order:

1. All `seed` + `custom` rows for that format (creation order).
2. The most recent **3** `liked` rows for that format (newest first).

Helper (web): `lib/style-examples.ts`
- `listExamples(db, format)` -> grouped `{ seed, custom, liked }` for settings.
- `promptExamples(db, format): string[]` -> the ordered list above for prompts.

Core prompt builders change signature to accept examples instead of importing the
constants:

- `buildLinkedInPrompt(transcript, details, examples: string[])`
- `buildArticlePrompt(transcript, details, examples: string[])`
- New `buildSelectionRewritePrompt(format, fullDraft, selection: string, details, examples: string[])`
  — instruct the model to rewrite ONLY the given span, preserving tone/style and
  the surrounding text, and return just the rewritten span (no preamble). Keeps
  the hashtag/bold-header rules already in the builders.

`summary-examples.ts` keeps the constants (now used only for seeding).

## APIs

### `GET /api/transcribe`
Remove `.limit(5)`. Return all rows newest-first. Add `hasLinkedin` /
`hasArticle` booleans (whether the cached columns are non-empty) so the popover
can indicate available drafts.

### `DELETE /api/transcribe/[id]`
Delete the transcription row and best-effort remove `data/uploads/<id>`.

### `GET /api/transcribe/[id]` (extend)
Add `likedLinkedin` / `likedArticle` booleans: true when a `kind='liked'` row for
that format has `text` equal to the corresponding cached draft. Lets the smiley
render filled on reload.

### `POST /api/transcribe/[id]/summary` (extend request shapes)
Existing default `{format}` (serve cache or generate) unchanged. New shapes:
- `{format, regenerate:true}` — bypass cache, generate whole draft using
  `promptExamples`, save to the cached column, return `{text}`.
- `{format, draft, selStart, selEnd}` — validate the span, call
  `buildSelectionRewritePrompt` with `draft.slice(selStart, selEnd)`, splice the
  rewritten span back into `draft`, save, return `{text}` (full draft).
- `{format, draft, save:true}` — persist a hand-edited `draft` to the cached
  column, return `{text}`.

All writes update `updatedAt`. Generation errors return 500 with `{error}` as
today.

### `DELETE /api/transcribe/[id]/summary`
Null both `summary_linkedin` and `summary_article` (Clear drafts).

### `POST /api/transcribe/[id]/like`  `{format}`
Toggle: if a `kind='liked'` row for `format` with `text` == the current cached
draft exists, delete it; else insert one. No-op 409 if the cached draft is empty.
Return `{liked}`.

### Style examples CRUD
- `GET  /api/style-examples?format=...` -> `{ seed:[], custom:[], liked:[] }`
  (each item `{id, text}`).
- `POST /api/style-examples` `{format, text}` -> add `kind='custom'`, return item.
- `PATCH /api/style-examples/[id]` `{text}` -> edit text (any kind).
- `DELETE /api/style-examples/[id]` -> remove the row.

## UI

### Draft panel (`TranscribeClient.tsx`)
- Edit/Preview toggle (reuse `Segmented`). Preview = existing `summaryToHtml`
  bold render; Edit = a `<textarea>` bound to the draft, tracking selection
  (`selectionStart`/`selectionEnd`).
- Buttons row: **Regenerate all**, **Regenerate selection** (disabled unless a
  non-empty selection exists in the textarea), **Copy** (existing, rich+plain),
  and the **Like smiley** toggle.
- Smiley: `lucide-react` `Smile` icon; filled/accent when liked. Hover tooltip
  (title attr + styled tooltip consistent with house rules): "Mark this draft as
  good — future drafts will use it as inspiration."
- Loading + error states on each action (spinner on the acting button, inline
  error with retry), per anti-vibecode feedback rules.
- Saving: hand edits persist via the `save:true` shape on blur or before
  regenerate/like, so like/selection always act on the saved text.

### Past-transcriptions popover (`PastTranscriptions.tsx`)
- List all rows. Each row: filename, status, date, small "LinkedIn / Article"
  availability chips, and actions **Open**, **Clear drafts**, **Delete**.
- **Open** calls an `onOpen(id)` prop -> `TranscribeClient` loads
  `GET /api/transcribe/[id]`, sets `tx`, and pre-populates `formatText` from the
  cached `summaryLinkedin` / `summaryArticle` so switching tabs shows prior
  drafts with no regeneration.
- Delete uses a confirm affordance (no native `confirm()` dialog — an inline
  "Delete? yes/no" per house rules) before calling `DELETE`.

### Settings (`settings/page.tsx` + new client component)
- New "Draft style & inspiration" section. Per format (LinkedIn, Article):
  - Style examples: seed + custom rows, each an editable textarea with Save /
    Delete; an **Add example** control (POST custom).
  - Liked drafts: text preview + **Remove** (DELETE).
- Backed by the style-examples CRUD endpoints via a client component.

## One-off cleanup

Run once against `data/app.db`:
`UPDATE transcriptions SET summary_linkedin=NULL, summary_article=NULL;`
Executed during implementation via a short node script using core `openDb`.

## Testing

Core:
- `buildLinkedInPrompt` / `buildArticlePrompt` include the passed examples and
  keep the hashtag/bold-header rules (update existing tests for the new arg).
- `buildSelectionRewritePrompt` includes the span, the format rules, and grounding.
- `seedStyleExamples`: seeds when empty, no-ops when rows exist.

Web:
- `style-examples` lib: `promptExamples` ordering (seed+custom then last-3 liked)
  and the liked cap.
- summary route: regenerate bypasses cache; selection splices span; save persists;
  DELETE clears both.
- like toggle: insert then delete round-trip; 409 on empty draft.
- style-examples CRUD happy paths.
- Existing `render-summary` / `transcribe-format` tests stay green.

## Rollout

Subagent-driven execution with per-task review. Push to `main` when the whole
branch review passes.
