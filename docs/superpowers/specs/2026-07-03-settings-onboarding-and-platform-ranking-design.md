# Settings onboarding + platform photo ranking

Date: 2026-07-03
Package: `packages/web` + `packages/core`
Status: approved, ready to plan

## Problem

Two gaps, both around getting set up and getting good output:

1. **Onboarding is opaque.** The Settings page asks for six API keys / OAuth
   client credentials but gives no help on where to find them. A new operator
   has no idea how to get a Groq key or register a Google/Canva OAuth app, and
   there is no at-a-glance view of what is connected.
2. **Photo ranking is single-purpose.** The Drive photo sorter scores every
   photo against one hardcoded criterion: "LinkedIn profile headshot". Caleb
   wants to rank photos for different destinations, an aesthetic Instagram feed
   (which does not need a person in it), LinkedIn, or a generic profile picture,
   and to tune the Instagram and LinkedIn criteria himself.

## Goals

**Settings**
1. Per-provider "how to get this" guides (collapsible) for Groq, Google, Canva.
   Anthropic instead says "Ask Caleb for help".
2. A row of connection-status pills at the top of Settings using semantic
   colour: green = connected/ready, amber = needs setup.

**Sorter**
3. A platform toggle (Instagram / LinkedIn / Profile picture) chosen before a
   scan; the vision model ranks against that platform's criteria.
4. Instagram ranking favours aesthetic feed-worthy photos (composition, colour,
   light, vibe) and does not require a person; its quality pre-filter is loosened
   so moody/dark/artistic shots still reach the model.
5. The Instagram and LinkedIn ranking criteria are editable in Settings.
   Profile picture uses a fixed built-in.

Non-goals:
- No new generic key-value settings store; a small purpose-built
  `ranking_contexts` table mirrors the existing `style_examples` convention.
- Profile picture context is not editable.
- No change to how keys persist (still the `.env` file via `saveKeys`).

## Design

### Part A, Settings onboarding

#### A1. Connection status pills

`app/settings/page.tsx` (server component) already reads `getConnections()` and
the Google/Canva OAuth tokens. Compute a readiness list and render a new
presentational `ConnectionPills` client-free component at the top of the page,
directly under the `<h1>Settings</h1>`, before the "API keys" heading.

Readiness per service (`ready: boolean`):
- **Groq** — `GROQ_API_KEY` present (`connections` groq `.configured`).
- **Claude** — `ANTHROPIC_API_KEY` present (anthropic `.configured`).
- **Google** — configured AND an OAuth token exists
  (`getToken(getDb(), "google") !== null`). Keys pasted but not yet connected =
  amber.
- **Canva** — `CANVA_CLIENT_ID` present AND `getToken(getDb(), "canva") !== null`.

`ConnectionPills` renders one pill per service: a coloured dot + label. Ready
uses Tailwind's built-in emerald palette (`bg-emerald-50 text-emerald-700
ring-1 ring-emerald-600/20`, emerald dot); needs-setup uses amber (`bg-amber-50
text-amber-700 ring-1 ring-amber-600/20`, amber dot). These are semantic
(green = success/ready, amber = warning/incomplete) and avoid the undefined
`text-warning` token (known gotcha, use amber-*). Labels: "Groq", "Claude",
"Google", "Canva". Ready label suffix "connected", else "needs setup". Pills
wrap on narrow screens (`flex flex-wrap gap-2`).

#### A2. Per-provider key guides

`KeyForm.tsx` already groups the six fields by provider (`GROUPS`: Claude, Groq,
Google, Canva). Under each group's `<legend>`, render a collapsible guide using
a native `<details><summary>How to get this</summary>…</details>` (no JS,
keyboard-accessible, matches the low-noise house style). Content comes from a new
static module `app/settings/key-guides.ts`:

```ts
export type Guide = { steps: string[] } | { note: string };
export const KEY_GUIDES: Record<string, Guide> = {
  "Claude (Anthropic)": { note: "Ask Caleb for help." },
  "Groq (transcription)": { steps: [ ... ] },
  "Google": { steps: [ ... ] },
  "Canva": { steps: [ ... ] },
};
```

Guide bodies (final copy, no em dashes):

- **Groq** (steps):
  1. Go to console.groq.com and sign in.
  2. Open "API Keys" in the left menu.
  3. Click "Create API Key" and give it a name.
  4. Copy the key (it starts with gsk_) and paste it below. Groq shows it once.

- **Google** (steps):
  1. Open console.cloud.google.com and create or pick a project.
  2. In "APIs and Services > Library", enable the Google Drive API and the
     Google Sheets API.
  3. In "APIs and Services > OAuth consent screen", set it up as External and
     add your own email as a test user.
  4. In "APIs and Services > Credentials", choose "Create credentials > OAuth
     client ID > Web application".
  5. Under "Authorized redirect URIs" add both
     http://localhost:3000/api/google/callback and
     http://localhost:3001/api/google/callback (the app uses 3001 if 3000 is
     taken).
  6. Copy the Client ID and Client secret into the fields below.

- **Canva** (steps):
  1. Go to canva.com/developers and sign in.
  2. Create an integration under "Your integrations > Create an integration".
  3. In "Configuration > Add redirect URL", add
     http://127.0.0.1:3000/api/canva/callback. Use 127.0.0.1, not localhost,
     Canva rejects localhost.
  4. In "Scopes", enable design content read and write and asset read.
  5. Copy the Client ID, generate a Client secret, and paste both below.

- **Claude (Anthropic)**: renders the `note` ("Ask Caleb for help.") instead of
  a step list.

`KeyForm` maps `KEY_GUIDES[g.title]`: if it has `steps`, render an ordered list;
if it has `note`, render the note line. Styling: muted text, small, inside the
`<details>` opened body, indented under the legend.

### Part B, Sorter platform ranking

#### B1. `ranking_contexts` table + `ranking-context.ts` core module

Schema (`packages/core/src/schema/index.ts`), new table mirroring
`style_examples` conventions:

```ts
export const rankingContexts = sqliteTable("ranking_contexts", {
  platform: text("platform").primaryKey(), // instagram|linkedin
  text: text("text").notNull(),
  updatedAt: integer("updated_at").notNull().default(0),
});
```

Migration (`packages/core/src/migrate.ts`): add to `DDL`:
```sql
CREATE TABLE IF NOT EXISTS ranking_contexts (
  platform TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
)
```
and add `addColumnIfMissing(db, "jobs", "platform", "TEXT")` in `runMigrations`.
No seeding: defaults live in code, an absent row means "use the default", so
edits are stored and a reset just deletes the row.

New module `packages/core/src/ranking-context.ts`:

```ts
export const PLATFORMS = ["instagram", "linkedin", "profile"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const EDITABLE_PLATFORMS = ["instagram", "linkedin"] as const;
export type EditablePlatform = (typeof EDITABLE_PLATFORMS)[number];

export const DEFAULT_CONTEXTS: Record<EditablePlatform, string> = {
  instagram: INSTAGRAM_DEFAULT,
  linkedin: LINKEDIN_DEFAULT,
};
export const PROFILE_CONTEXT = "…fixed…";

export function isPlatform(v: string): v is Platform
export function isEditablePlatform(v: string): v is EditablePlatform
export function defaultContext(platform: Platform): string   // profile -> PROFILE_CONTEXT
export function getRankingContext(db, platform: Platform): string
  // editable + row present -> row.text; else defaultContext(platform)
export function setRankingContext(db, platform: EditablePlatform, text: string): void
  // upsert on platform PK (onConflictDoUpdate), updatedAt = Date.now()
export function resetRankingContext(db, platform: EditablePlatform): void
  // delete row -> getRankingContext falls back to default
```

Default context copy (these ARE the scoring criteria injected into the prompt):

- **INSTAGRAM_DEFAULT**: "Judge this photo as content for an aesthetic Instagram
  feed. It does not need a person in it. Reward strong composition (rule of
  thirds, leading lines, balance, intentional negative space), a cohesive and
  pleasing colour palette with rich but natural colour, flattering light (soft,
  golden hour, or moody done well), a clear subject or strong sense of place with
  an editorial magazine-like feel, and an overall vibe that would stop a scroll.
  Penalise cluttered or messy framing, muddy or clashing colour, flat or
  unflattering light, harsh flash, accidental-looking blur or noise, and generic
  snapshots with no point of interest."
- **LINKEDIN_DEFAULT**: "Judge this photo as a professional LinkedIn headshot.
  Reward one clearly-focused person as the subject, natural eye contact and an
  approachable expression, head and shoulders framing that is neither too far
  nor too tight, even flattering light with no harsh shadows or blowout, a clean
  non-distracting background, and professional or smart-casual attire. Penalise
  casual group shots, full-body or distant framing, no clear face, busy
  backgrounds, and poor lighting."
- **PROFILE_CONTEXT** (fixed): "Judge this photo as an all-purpose profile
  picture or avatar. Reward one clear well-lit face looking toward the camera,
  tight head and shoulders framing that crops cleanly to a circle, a friendly
  natural expression, and a simple uncluttered background. Penalise multiple
  people, distant or full-body shots, obscured or side-turned faces, heavy
  shadows, and busy backgrounds."

#### B2. `rank.ts`, context-driven prompt + platform-aware heuristics

`buildVisionPrompt` becomes context-driven:
```ts
export function buildVisionPrompt(name: string, context: string): string {
  return [
    `You are screening one candidate photo ("${name}").`,
    context,
    `Score it from 0 to 100 on how well it fits, then give 1 to 3 short reasons (each under 12 words).`,
  ].join("\n");
}
```

Heuristics gain a lenient variant for Instagram:
```ts
export const HEURISTICS = { minLongEdge: 256, minSharpness: 80, brightnessMin: 40, brightnessMax: 225, aspectMin: 0.5, aspectMax: 2.0 };
export const HEURISTICS_LENIENT = { minLongEdge: 256, minSharpness: 25, brightnessMin: 12, brightnessMax: 248, aspectMin: 0.5, aspectMax: 2.0 };
export function scoreHeuristics(m: ImageMetrics, platform: Platform = "linkedin"): HeuristicVerdict {
  const H = platform === "instagram" ? HEURISTICS_LENIENT : HEURISTICS;
  // same checks against H; generic reject reasons (no "headshot crop" wording)
}
```
Reject reason for aspect becomes "Awkward crop shape" (platform-neutral).
`scoreHeuristics` imports `Platform` from `./ranking-context.js`. The default
`"linkedin"` keeps the existing single-arg test call working unchanged.

#### B3. Thread platform through ranking

- `ranking.ts` `runRanking(db, jobId, deps, platform: Platform = "linkedin")`,
  the heuristics call becomes `scoreHeuristics(m, platform)`. Everything else
  unchanged; `deps.scoreVision(photo)` still carries the context via closure.
- `anthropic.ts` `scorePhoto(client, img, context: string)`, passes
  `buildVisionPrompt(img.name, context)`.
- `ingest.ts` `createScanJob(db, { driveFolderId, driveFolderName, platform })`,
  add optional `platform` written to the new `jobs.platform` column (default
  `"linkedin"` when omitted).
- `lib/sorter.ts` `startScan(db, drive, { folderId, folderName, platform })`:
  fetch `const context = getRankingContext(db, platform)` at scan start, pass
  `platform` to `createScanJob` and to `runRanking(db, jobId, {…, scoreVision:
  … scorePhoto(client, {…}, context)}, platform)`.
- `app/api/sorter/jobs/route.ts`: read `platform` from the POST body, validate
  with `isPlatform` (default `"linkedin"` if missing/invalid), pass to
  `startScan`.

#### B4. Sorter platform toggle (`SorterClient.tsx`)

Before a scan, show a 3-way segmented toggle (Instagram / LinkedIn / Profile
picture) styled like the app's existing pill toggles (grey track, one active
segment, no accent stripe). Selected platform in component state, default
`"linkedin"` (preserves current behaviour). Sent in the `/api/sorter/jobs` POST
body. Disabled while a job is running. Optionally show the job's platform in the
results header ("Ranked for Instagram") from `job.platform`.

#### B5. Settings "Photo ranking" section

New route `app/api/ranking-context/route.ts`:
- `GET` → `{ instagram: string, linkedin: string, defaults: { instagram, linkedin } }`
  (current effective values + defaults, for the reset affordance).
- `PUT` body `{ platform, text }` → validate `isEditablePlatform`, non-empty
  text, `setRankingContext`; 400 otherwise.
- `DELETE` `?platform=` → validate editable, `resetRankingContext`, return the
  restored default.

New client component `app/settings/RankingContexts.tsx`: two labelled textareas
(Instagram, LinkedIn) seeded from `GET`, each with a "Save" button (inline
saved/error feedback like `KeyForm`) and a "Reset to default" button. Rendered in
`app/settings/page.tsx` as a new "Photo ranking" section (heading + one-line
helper "Tune what the photo sorter looks for on each platform.").

## Files touched

**Core**
- `packages/core/src/schema/index.ts` — add `rankingContexts` table.
- `packages/core/src/migrate.ts` — DDL for `ranking_contexts`, `addColumnIfMissing` jobs.platform.
- `packages/core/src/ranking-context.ts` — NEW: platforms, defaults, get/set/reset.
- `packages/core/src/rank.ts` — context-driven `buildVisionPrompt`, lenient heuristics + platform param.
- `packages/core/src/ranking.ts` — `runRanking` platform param.
- `packages/core/src/ingest.ts` — `createScanJob` platform.

**Web**
- `packages/web/lib/anthropic.ts` — `scorePhoto(…, context)`.
- `packages/web/lib/sorter.ts` — fetch context, thread platform.
- `packages/web/app/api/sorter/jobs/route.ts` — read/validate platform.
- `packages/web/app/sorter/SorterClient.tsx` — platform toggle.
- `packages/web/app/api/ranking-context/route.ts` — NEW: GET/PUT/DELETE.
- `packages/web/app/settings/RankingContexts.tsx` — NEW: editable contexts UI.
- `packages/web/app/settings/key-guides.ts` — NEW: static guide content.
- `packages/web/app/settings/KeyForm.tsx` — render per-provider guides.
- `packages/web/app/settings/ConnectionPills.tsx` — NEW: status pills.
- `packages/web/app/settings/page.tsx` — render pills + RankingContexts.

## Testing

- Unit (core): `ranking-context.test.ts` — `getRankingContext` returns default
  when unset and stored text when set; `profile` always returns `PROFILE_CONTEXT`
  and ignores any row; `setRankingContext` upserts; `resetRankingContext`
  deletes so the default returns; `isPlatform`/`isEditablePlatform` guards.
- Unit (core): `rank.test.ts` additions — `buildVisionPrompt(name, context)`
  includes the context text and the photo name; `scoreHeuristics(m, "instagram")`
  passes a dark/soft photo that `scoreHeuristics(m, "linkedin")` rejects
  (brightness 20, sharpness 40 → rejected strict, accepted lenient).
- Migration: after `runMigrations`, `ranking_contexts` exists and `jobs` has a
  `platform` column (PRAGMA check), idempotent on a second run.
- Manual (`npm run dev`): Settings shows pills (correct green/amber per real
  state), each provider guide expands with steps (Anthropic shows the note);
  sorter toggle changes ranking (Instagram surfaces scenic/no-face photos,
  LinkedIn surfaces headshots); edit + save the Instagram context in Settings and
  confirm a new scan uses it; Reset restores the default.

## Dev + house rules

- After core schema/module changes, rebuild core
  (`npm -w @event-editor/core run build`) and re-migrate the dev DB
  (root `npm run migrate`) before the web app sees the new exports/columns.
- Reviewer caveat: `packages/web` has 5 PRE-EXISTING tsc errors in
  `test/docs.test.ts` + `test/canva-oauth.test.ts`; "clean" = no new errors from
  touched files.
- Anti-vibecode: one accent, semantic colour only for meaning (green ready /
  amber needs-setup pills, the sorter toggle stays neutral grey with no accent
  stripe), soft shadows, sentence-case, no em dashes. Reuse existing tokens and
  the `.field` / `.btn` / `.card` classes.
