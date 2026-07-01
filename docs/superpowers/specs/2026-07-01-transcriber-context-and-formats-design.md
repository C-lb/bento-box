# Audio transcriber: context file + multi-format summaries

Date: 2026-07-01
Status: approved, ready for planning

## Goal

Two additions to the audio transcriber:

1. An optional **context file** (`.md`, `.html`, `.pdf`, `.pptx`) uploaded alongside the
   audio, parsed to text and used to ground the summaries. From it we extract simple event
   details: event name, event description, speakers, sponsors, and their companies.
2. A **format toggle** on the finished summary: General > LinkedIn > Article. Each is the
   transcript recontextualised into that format. General is the plain summary produced today.

Non-goals for this pass (explicitly deferred): pushing LinkedIn/Article into the Google Doc
(the Doc stays General-only), and attaching more than one context file per transcription.

## Current pipeline (unchanged parts)

Upload (streamed raw body, large audio) -> ffmpeg chunk -> Groq Whisper per chunk -> merge
segments -> **General summary** (Claude `summarizeTranscript`) -> Google Doc. One
`transcriptions` row holds `summary_text`. Statuses: `uploading|transcribing|summarizing|
creating_doc|done|error`.

The General summary and the Google Doc are untouched by this work.

## Upload and linkage

Audio keeps its current streamed upload, so large files are never buffered into memory. The
context file is small and is handled separately, before the audio:

1. If a context file is chosen, the client POSTs it to `POST /api/transcribe/context`
   (multipart). The server parses it to plain text, stashes the raw file under
   `data/uploads/context/<uuid>.<ext>`, and returns `{ contextId }`.
2. The client POSTs the audio to `POST /api/transcribe` as today, adding an optional
   `x-context-id` header. On row creation the server links the stash: moves the file to
   `data/uploads/<id>/context.<ext>`, sets `context_file_path` and `context_text` on the row,
   then starts transcription.

If the audio POST never arrives (user abandons), stray stash files are harmless; a stash with
no matching audio is just left on disk (out of scope to garbage-collect).

### Parsing to text

- `.md`, `.html`: in-house. Strip script/style, tags to whitespace, collapse runs, decode the
  common HTML entities. No dependency.
- `.pdf`, `.pptx`: one dependency, `officeparser` (pure JS, handles both). If it proves
  unreliable during implementation, fall back to `pdf-parse` for PDF and a JSZip + slide-XML
  reader for PPTX; the parser lives behind a single `parseContextFile(buffer, ext)` function so
  the choice is swappable without touching callers.

Parsing failure is non-fatal: store empty `context_text`, keep going (best effort).

## Event details extraction

After the General summary is produced (and before the Google Doc step so ordering is
deterministic), one extraction call always runs, using `context_text` plus the transcript. With
no context file it is a best-effort read of the transcript alone.

Output is structured JSON stored in `event_details`:

```json
{
  "eventName": "string",
  "eventDescription": "string",
  "speakers": [{ "name": "string", "company": "string" }],
  "sponsors": [{ "name": "string", "company": "string" }]
}
```

Extraction uses the same Anthropic structured-output pattern as `scorePhoto`
(`output_config` cast, per the existing SDK-0.69 workaround). A pure `buildEventDetailsPrompt`
builder produces the messages; the web layer owns the SDK call.

## Schema changes

New nullable columns on `transcriptions`, added via a guarded `addColumnIfMissing` ALTER run in
`runMigrations` AFTER the CREATE block (the existing `CREATE TABLE IF NOT EXISTS` silently
no-ops on an existing table, so new columns need explicit idempotent ALTERs, per the project's
known migration gotcha):

- `context_file_path TEXT`
- `context_text TEXT`
- `event_details TEXT`  (JSON string)
- `summary_linkedin TEXT`
- `summary_article TEXT`

The dev DB at `data/app.db` is re-migrated with the ROOT `npm run migrate` (not the `-w core`
form, which targets the wrong file).

## Summary formats

Pure, unit-tested prompt builders in `core/transcribe.ts`. Each takes the transcript plus the
current (possibly user-edited) event details.

- **General** — `buildSummaryPrompt`, unchanged.
- **LinkedIn** — `buildLinkedInPrompt(transcript, details)`. Structure:
  - 2 to 4 short paragraphs, 2 to 3 lines each, opening on what the session was about.
  - A line `Key takeaways from the session:` followed by bullet pointers drawn from the key
    speakers.
  - A line `Our sincere thanks to...` naming the speakers, and separately thanking sponsors and
    partners for their support.
  - Topic hashtags at the end.
  - No sign-off. No em dashes.
  - The example posts the user supplied are embedded in the prompt module as style reference.
- **Article** — `buildArticlePrompt(transcript, details)`. Max 1000 words, SEO structure
  (title, section headers, an explicit key-takeaways treatment). The example articles the user
  supplied are embedded as style reference.

Grounding is best effort: any speaker/sponsor the details do not supply is drawn from the
transcript if possible, and the thanks/hashtags gracefully omit what cannot be grounded. No
hard blocking when there is no context file.

### Generation timing

Lazy and cached. General is produced during the pipeline as today. LinkedIn and Article are
generated the first time the user switches to that tab, via
`POST /api/transcribe/[id]/summary { format: "linkedin" | "article" }`:

- If the column is already populated, return it.
- Otherwise generate from transcript + `event_details`, store in `summary_linkedin` /
  `summary_article`, return it.

## Routes

- `POST /api/transcribe/context` (new) — multipart context upload; parse; stash; return
  `{ contextId }`.
- `POST /api/transcribe` (modified) — accept optional `x-context-id`; link stash; unchanged
  otherwise.
- `GET /api/transcribe/[id]` (extended) — also return `hasContext`, `eventDetails` (parsed),
  `summaryLinkedin`, `summaryArticle`.
- `POST /api/transcribe/[id]/summary` (new) — `{ format }`; generate-or-return cached.
- `PATCH /api/transcribe/[id]/details` (new) — save edited `event_details`; on save, null out
  `summary_linkedin` and `summary_article` so they regenerate against the corrected details.

## UI (anti-vibecode, light desktop tool)

On the upload form:

- A second, optional file input below the audio input, labelled "Optional: add context
  (agenda, deck, or notes)", `accept=".md,.markdown,.html,.pdf,.pptx"`, with a muted line
  listing accepted types. Audio stays required to enable Transcribe.

On the done state:

- **Event details panel** — editable: event name (input), description (textarea), speakers and
  sponsors as add/remove rows of name + company, and a Save button. Full anti-vibecode field
  states. Saving confirms inline and clears the cached LinkedIn/Article.
- **Segmented toggle** — General | LinkedIn | Article, a plain grey segmented control with one
  moving thumb (not liquid glass; this is the light desktop tool). The selected format renders
  in a card with a **Copy** button (label swaps to "Copied!" for ~1.2s) and a spinner while a
  format is being generated. Errors show an inline retry.
- The existing "Open in Google Docs" action stays (General to Doc).

## Testing

- Core (pure, unit): `parseContextFile` for each type (fixtures), `buildLinkedInPrompt`,
  `buildArticlePrompt`, `buildEventDetailsPrompt` (assert structure/markers/no-em-dash rule
  present in the produced messages), and the `event_details` JSON round-trip.
- Web: route DTO shapes for the new/extended routes (mocked SDK + DB), and the summary
  cache-or-generate branch.

## Deferred / follow-ups

- LinkedIn/Article into the Google Doc.
- Multiple context files per transcription and stash garbage collection.
- Re-running General with context (General currently ignores context; only LinkedIn/Article and
  extraction use it).
