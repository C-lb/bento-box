# Batch Headshots from a Google Sheet

The Headshot Studio batch tool reads a master Google Sheet to generate headshots for multiple people at once.

## Prerequisites

A Google account with headshot photos already organized in Google Drive, and a Google Sheet with a list of people.

## Step 1: Connect Google and Authorize the Sheets Scope

The batch tool needs access to your Google Sheets. If you connected Google before Plan 4c, you'll need to re-authorize with the new `spreadsheets.readonly` scope.

1. Open http://127.0.0.1:3000/settings in your browser.
2. Scroll to **Google** and look for a **Re-authorize** or **Update Scopes** button if present.
3. Click it, then approve the consent screen. If no button appears, you're already authorized for sheets.

## Step 2: Prepare Your Google Sheet

Create a Google Sheet with at least these columns:

- **name** - the person's name (used for photo matching if no photo column exists)
- **title** - the person's job title
- **photo** (optional, recommended) - a reference to a headshot:
  - A Google Drive file ID (from `drive.google.com/file/d/{FILE_ID}`)
  - A Drive share link (e.g., `https://drive.google.com/file/d/ABC123/view`)
  - The filename of a photo in your chosen Drive folder (e.g., `alice.jpg`)

The first row must be a header row. Any additional columns are ignored. For example:

| name | title | photo |
|------|-------|-------|
| Alice Johnson | Engineer | alice.jpg |
| Bob Smith | Designer | bob-headshot.png |

## Step 3: Choose a Drive Folder for Photo Matching

If your **photo** column contains filenames instead of Drive file IDs or links, the batch tool will match each filename against the filenames in a Drive folder you select. The matching is case-insensitive, ignores file extensions, and tolerates minor punctuation differences.

- If a filename match finds exactly one photo, it's used.
- If a filename is ambiguous (multiple matches) or unmatched, that row is shown in the results but not rendered until you resolve it.

If your **photo** column has Drive file IDs or links, folder selection is skipped.

## Step 4: Pick a Renderer and Style

The batch tool supports two renderers:

**Local frame** - renders headshots in the app using the frame you configure in the Headshot Studio UI.

**Canva template** - renders using a Canva brand template. Requires the Canva setup from `docs/setup/canva.md`.

Select one renderer and one style. The same style is applied to all headshots in the batch.

## Step 5: Generate and Review

1. Paste your Google Sheet's URL into the batch form.
2. Choose your renderer, style, and (if using filenames) Drive folder.
3. Click **Generate** to process the batch.
4. Review the results grid. Rows with errors or unmatched photos are marked.
5. For any failed row, click **Retry** to regenerate just that headshot.
6. Once satisfied, click **Download All** to get a ZIP file containing all PNGs.

## Concurrency Limit

The `EE_BATCH_CONCURRENCY` environment variable (default 3) limits how many headshots are rendered in parallel. If you hit Canva rate limits, lower it. If your Canva rate limits are generous and you have a large batch, raise it for faster generation.

## Troubleshooting

- **Re-authorization prompt:** If you see "needs re-authorization" in the app, visit `/settings` and click re-auth.
- **Photos not found:** Check that your Drive folder is shared with the app's Google account, and that filenames are typed correctly in the sheet (punctuation is forgiving, but spelling must match).
- **Canva export fails:** Ensure your Canva account is Teams or Enterprise (Free and Pro cannot export). See `docs/setup/canva.md` for full Canva setup.
