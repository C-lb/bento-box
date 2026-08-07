# Document to doc: summarise a document the same way we summarise a recording

Date: 2026-08-07
Status: approved, not yet planned

## Problem

`/transcribe` turns an audio or video recording into a Google Doc laid out as
Summary, LinkedIn post, Article, Transcript. The only way in is a media file.
When the source material is already written down, a slide deck, a report, a
Google Doc, there is no way to get the same output without first inventing a
recording.

This adds a second input path to the same tool: drag a document, or pick a
Google Doc, and get the same doc layout out of it.

## What the user does

`/transcribe` gains a segmented source switcher.

```
/transcribe
+------------------------------+
|  ( Audio/video )  ( Document )|
+------------------------------+
|   drag a file here, or        |
|   [ Connect a Google Doc ]    |
+------------------------------+
  Past transcriptions (mixed list, each row tagged by source)
```

For a dragged document, a new Google Doc is created in Drive, exactly as the
audio path does today (`createGoogleDoc` calls `files.create` with no parent, so
it lands in My Drive root).

For a picked Google Doc, the output is written into a **new tab inside that
same document**, so the summary lives next to the original and there is one
link, not two.

```
Source doc: "Q3 board pack"
+----------------------------+
| > Q3 board pack  (original) |
| > Summary        (new tab)  |
|     Summary                 |
|     LinkedIn post           |
|     Article                 |
+----------------------------+
```

## Architecture

The chosen approach is one section model with two renderers. Content logic
lives in one place and only the output encoding differs.

### Section model

In `packages/core/src/transcribe.ts`:

```ts
export type DocBody =
  | { kind: "paras"; text: string }
  | { kind: "segments"; segments: MergedSegment[] };   // timestamped

export type DocSection = { heading: string; body: DocBody };

export function buildDocSections(row): DocSection[];
```

`buildDocSections` is the single place that decides which sections a row has:

| Source kind | Sections |
| --- | --- |
| `audio` | Summary, LinkedIn post, Article, Transcript (timestamped) |
| `document` | Summary, LinkedIn post, Article, Source document (plain paragraphs) |
| `gdoc` | Summary, LinkedIn post, Article |

A `gdoc` row gets no source section because the original is the sibling tab in
the same file. Copying it in would be pure duplication. A dragged document is
not in Drive at all, so its text is kept to leave the output self-contained.

Drafts stay omitted when null, which is the behaviour today.

### Renderers

Two pure functions consume `DocSection[]`. Neither touches Google, so both are
testable as data in, data out.

- `buildDocHtml(sections)` is the existing string builder with a new signature.
  Output for audio rows is unchanged.
- `buildTabRequests(sections, tabId)` returns the `documents.batchUpdate`
  request array: `insertText` plus `updateParagraphStyle` (HEADING_1) over the
  computed ranges, every request carrying `location.tabId`.

Resignaturing `buildDocHtml` touches two callers, `lib/transcriber.ts` and
`lib/doc-sync.ts`.

### Schema

Three nullable columns through the existing `addColumnIfMissing` pattern in
`packages/core/src/migrate.ts`:

- `source_kind`, one of `audio`, `document`, `gdoc`. Null on existing rows and
  read as `audio`, so nothing needs backfilling.
- `source_doc_id`, the Google Doc a tab was written into.
- `doc_tab_id`, the tab we own.

For document sources `transcript_text` holds the extracted text and
`transcript_segments` stays null. `segmentsOf` in `doc-sync.ts` already falls
back to a single untimed block when segments are missing, so that path stays
coherent.

### Ingest

One new route, `POST /api/transcribe/document`, with two body shapes.

**Multipart, dragged file.** Extend `parseContextFile` in `lib/context.ts`,
which already handles md, markdown, html, pdf and pptx through officeparser.
Add `txt` (plain read) and `docx` (officeparser handles it already). Row gets
`source_kind='document'`.

**JSON `{ fileId, name }`, Picker.** `drive.files.export(fileId, 'text/plain')`.
Row gets `source_kind='gdoc'` and `source_doc_id`.

Either shape stores the extracted text into `transcript_text` and starts the
job. This mirrors the existing `from-convert` route, which already does make a
row, put content where the runner expects it, start it.

Extracted text is capped at 400,000 characters, roughly 100k tokens, which
sits inside the summary model's context with room for the prompt. Over the cap
is an error, never a truncation.

**Naming.** `docBaseName` only strips an extension when it recognises an
audio or video one, so "report.pdf" comes back as "report.pdf" and a new doc
would be named that. It gains the document extensions (txt, md, markdown, html,
pdf, docx, pptx) so dragged files produce a clean doc name. The audio behaviour
is unchanged because the check stays an allowlist.

The tab written into a picked Google Doc is titled "Summary".

The Picker is required rather than a preference. Scopes are `drive.readonly`,
`drive.file` and `spreadsheets.readonly`. `drive.file` grants access only to
files the app created or the user handed over through the Picker, so a pasted
Doc URL grants nothing and a tab write into it would 403. Picking through the
Google Picker is what authorises the write. `lib/google/pickerClient.ts`
already exists.

### Pipeline

In `packages/core/src/transcription.ts`, a sibling to `runTranscription`:

```ts
runDocumentSummary(db, id, deps)   // summarize -> extractDetails -> writeDoc
```

It reuses the same injected deps minus `prepareChunks` and `transcribeChunk`.
Statuses run `reading -> summarizing -> creating_doc -> done`, so the existing
polling UI and error surfacing work untouched. `reading` is a new status value,
so the client's status label map needs it or the raw string shows through.

`buildSummaryPrompt` currently opens with "You are summarizing a transcript of
an audio recording". Documents need a sibling `buildDocumentSummaryPrompt` with
the same output contract, same prose shape and same no-em-dashes rule, so the
Summary section reads identically regardless of source.

### Writing the tab

`lib/google/docs.ts` gains a Docs API writer beside the Drive import one:

```ts
writeDocTab(docs, docId, title, sections) -> { tabId }
```

Add the tab with `addDocumentTab`, read `tabId` off `AddDocumentTabResponse.tabProperties`
in the reply (verified against the API reference, no re-fetch needed), then
fill it with `buildTabRequests(sections, tabId)`. Two `batchUpdate` calls.
Persist `doc_tab_id`.

### Re-sync on draft edit

`syncTranscriptionDoc` currently calls `updateGoogleDoc`, which is a whole file
HTML re-import. Aimed at a multi-tab document that replaces the entire file,
including the user's original content. This is a live footgun today, harmless
only because no doc has ever had tabs.

So `syncTranscriptionDoc` dispatches on source kind, and for `gdoc` rows
`updateGoogleDoc` is unreachable by construction. The `gdoc` path is
`deleteTab(doc_tab_id)` then write a fresh one. Delete and recreate rather than
patching ranges, because it is idempotent and needs no bookkeeping about what
is currently in the tab. If the user deleted the tab themselves the delete
404s, which is swallowed, and a new tab is added. Self-healing.

This discards anything the user typed into our tab. That matches existing
semantics: `updateGoogleDoc`'s own comment already says manual edits are lost.

### Scope

`oauth.ts` adds `https://www.googleapis.com/auth/documents`. Existing tokens do
not carry it, so the first tab write on an old token 403s. That is caught
specifically and surfaced as "Reconnect Google in Settings to allow writing
into documents" rather than a generic failure. `buildAuthUrl` already sets
`prompt: "consent"` and `access_type: "offline"`, so reconnecting picks the new
scope up cleanly.

## Failure modes

All of these surface through the existing `error_message` column and the status
polling already on the page. No new error UI.

| Case | Handling |
| --- | --- |
| Unsupported extension | Rejected at the route, accepted list named in the message |
| PDF with no extractable text (scanned) | "No text found in this PDF, it may be scanned images." Caught explicitly, otherwise it silently summarises nothing |
| Document over the size cap | Rejected at 400,000 characters, cap named in the message. No silent truncation, because a half-read document produces a confident wrong summary |
| Picked a view-only Doc | Write 403, "You don't have edit access to that document." The Picker will hand you one |
| Old token missing `documents` scope | 403, reconnect message as above |
| Our tab deleted by hand | Delete 404 swallowed, fresh tab added |
| Google not connected | Existing preflight in `startTranscription` already covers it |

## Testing

Pure functions carry the weight: `buildDocSections` across all three source
kinds, `parseContextFile` for the new txt and docx paths, and the document
summary prompt builder.

`buildTabRequests` needs real scrutiny, because index arithmetic is where this
will break. Asserting on emitted request literals would restate the
implementation and pass regardless of correctness. Instead the test carries a
small pure "apply these requests to a string" model, runs the real output
through it, and asserts the resulting document text and heading ranges. That
fails when the maths is wrong.

This repo has produced three tests that could not fail, twice over real bugs.
`buildTabRequests` tests get mutation-checked before this is called done:
break the index maths on purpose, confirm the test goes red.

Routes get tests with the Drive and Docs clients mocked.

Scope and permission behaviour cannot be meaningfully mocked, so a live walk
stays owed:

1. Pick a real Google Doc through the Picker.
2. Confirm the tab appears with the right title and the right content.
3. Edit a draft, confirm the tab is replaced and the original tab is untouched.
4. Drag a docx and a scanned pdf, confirm the first works and the second gives
   the named error.

## UI

Segmented source switcher, drop zone, and Picker button on `/transcribe`, with
history rows tagged by source. Frontend work goes through the `anti-vibecode`
skill at implementation time rather than being designed here.

## Out of scope

- Writing into the body of a source Doc rather than a tab.
- Tabs for dragged files. There is no document to nest inside, so they keep
  creating a new doc.
- Chunked summarisation of documents past the size cap.
- Re-reading a source Doc when it changes. The summary is a snapshot.
