# Settings onboarding + platform photo ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-provider API-key setup guides + connection-status pills to Settings, and make the Drive photo sorter rank against a chosen platform (Instagram / LinkedIn / Profile picture) with Instagram and LinkedIn criteria editable in Settings.

**Architecture:** A new `ranking_contexts` table + `ranking-context.ts` core module holds per-platform criteria (defaults in code, edits in the DB). The vision prompt becomes context-driven and the quality heuristics gain a lenient Instagram variant; `platform` is threaded from the sorter UI through `startScan` → `runRanking` and persisted on `jobs`. Settings gains static guide content, status pills computed server-side, and an editable-context UI reusing existing form patterns.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind, better-sqlite3 + drizzle, Anthropic SDK (vision), Vitest.

## Global Constraints

- Monorepo: `packages/core` (logic + DB) and `packages/web` (Next app). Core tests: `npm -w @event-editor/core test`. Web tests: from `packages/web`, `npm test`. Web typecheck: `npx tsc --noEmit`.
- **After any `packages/core` source change, rebuild core** (`npm -w @event-editor/core run build`) before the web app / web tsc sees new exports, and re-migrate the dev DB with the ROOT script (`npm run migrate`) after schema/migration changes.
- **tsc caveat:** `packages/web` has 5 PRE-EXISTING tsc errors in `test/docs.test.ts` + `test/canva-oauth.test.ts`. "Clean" = no NEW errors from the task's own files.
- **Staged-refactor note:** Tasks 2–3 change core signatures (`buildVisionPrompt`, later `scorePhoto`) and will leave `packages/web` tsc temporarily red at the call sites until Task 4 rewires them. For Tasks 2–3 the gate is **core vitest only**; web tsc resumes as a gate from Task 4 onward.
- No new runtime dependency.
- Anti-vibecode: one accent; semantic colour only for meaning (green = ready, amber = needs setup; the sorter platform toggle stays neutral grey, no accent stripe); soft shadows; sentence-case labels; **no em dashes** in any user-facing copy. Reuse existing `.field` / `.btn` / `.card` classes and tokens. Amber uses Tailwind `amber-*` utilities (the `text-warning` token is undefined).
- Core DB test setup pattern (use verbatim): `openDb(join(tmpdir(), \`ee-<tag>-${Math.random().toString(36).slice(2)}.db\`))` then `runMigrations(db)`; import from `../src/index.js`.

---

### Task 1: Core data layer — ranking_contexts table + module

**Files:**
- Modify: `packages/core/src/schema/index.ts` (add `rankingContexts` table; add `platform` column to `jobs`)
- Modify: `packages/core/src/migrate.ts` (DDL for `ranking_contexts`; `addColumnIfMissing` jobs.platform)
- Create: `packages/core/src/ranking-context.ts`
- Modify: `packages/core/src/index.ts` (re-export the new module)
- Test: `packages/core/test/ranking-context.test.ts`

**Interfaces:**
- Produces:
  - table `rankingContexts { platform (PK), text, updatedAt }`; `jobs.platform` (nullable text)
  - `PLATFORMS`, `type Platform`, `EDITABLE_PLATFORMS`, `type EditablePlatform`
  - `INSTAGRAM_DEFAULT`, `LINKEDIN_DEFAULT`, `PROFILE_CONTEXT`, `DEFAULT_CONTEXTS`
  - `isPlatform(v): v is Platform`, `isEditablePlatform(v): v is EditablePlatform`
  - `defaultContext(platform: Platform): string`
  - `getRankingContext(db, platform: Platform): string`
  - `setRankingContext(db, platform: EditablePlatform, text: string): void`
  - `resetRankingContext(db, platform: EditablePlatform): void`

- [ ] **Step 1: Add the schema**

In `packages/core/src/schema/index.ts`, add a `platform` column to the existing `jobs` table (after `driveFolderName`):
```ts
  platform: text("platform"),
```
And add a new table at the end of the file:
```ts
export const rankingContexts = sqliteTable("ranking_contexts", {
  platform: text("platform").primaryKey(),
  text: text("text").notNull(),
  updatedAt: integer("updated_at").notNull().default(0),
});
```

- [ ] **Step 2: Add the migration**

In `packages/core/src/migrate.ts`, append to the `DDL` array:
```ts
  `CREATE TABLE IF NOT EXISTS ranking_contexts (
    platform TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
```
And in `runMigrations`, after the existing `addColumnIfMissing(...transcriptions...)` calls, add:
```ts
  addColumnIfMissing(db, "jobs", "platform", "TEXT");
```

- [ ] **Step 3: Write the failing test**

Create `packages/core/test/ranking-context.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations } from "../src/index.js";
import {
  getRankingContext,
  setRankingContext,
  resetRankingContext,
  defaultContext,
  isPlatform,
  isEditablePlatform,
  INSTAGRAM_DEFAULT,
  LINKEDIN_DEFAULT,
  PROFILE_CONTEXT,
} from "../src/ranking-context.js";

function freshDb() {
  const db = openDb(join(tmpdir(), `ee-rc-${Math.random().toString(36).slice(2)}.db`));
  runMigrations(db);
  return db;
}

describe("ranking-context", () => {
  it("returns the built-in default when nothing is stored", () => {
    const db = freshDb();
    expect(getRankingContext(db, "instagram")).toBe(INSTAGRAM_DEFAULT);
    expect(getRankingContext(db, "linkedin")).toBe(LINKEDIN_DEFAULT);
  });

  it("returns the fixed profile context and never reads a row for it", () => {
    const db = freshDb();
    expect(getRankingContext(db, "profile")).toBe(PROFILE_CONTEXT);
    expect(defaultContext("profile")).toBe(PROFILE_CONTEXT);
  });

  it("stores and reads back an edited context", () => {
    const db = freshDb();
    setRankingContext(db, "instagram", "my custom ig criteria");
    expect(getRankingContext(db, "instagram")).toBe("my custom ig criteria");
    // linkedin untouched
    expect(getRankingContext(db, "linkedin")).toBe(LINKEDIN_DEFAULT);
  });

  it("upserts on repeated sets", () => {
    const db = freshDb();
    setRankingContext(db, "linkedin", "first");
    setRankingContext(db, "linkedin", "second");
    expect(getRankingContext(db, "linkedin")).toBe("second");
  });

  it("reset deletes the row so the default returns", () => {
    const db = freshDb();
    setRankingContext(db, "instagram", "temp");
    resetRankingContext(db, "instagram");
    expect(getRankingContext(db, "instagram")).toBe(INSTAGRAM_DEFAULT);
  });

  it("guards platform strings", () => {
    expect(isPlatform("instagram")).toBe(true);
    expect(isPlatform("profile")).toBe(true);
    expect(isPlatform("tiktok")).toBe(false);
    expect(isEditablePlatform("linkedin")).toBe(true);
    expect(isEditablePlatform("profile")).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm -w @event-editor/core test -- ranking-context`
Expected: FAIL — cannot resolve `../src/ranking-context.js`.

- [ ] **Step 5: Write the module**

Create `packages/core/src/ranking-context.ts`:
```ts
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { rankingContexts } from "./schema/index.js";

export const PLATFORMS = ["instagram", "linkedin", "profile"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const EDITABLE_PLATFORMS = ["instagram", "linkedin"] as const;
export type EditablePlatform = (typeof EDITABLE_PLATFORMS)[number];

export const INSTAGRAM_DEFAULT =
  "Judge this photo as content for an aesthetic Instagram feed. It does not need a person in it. " +
  "Reward strong composition (rule of thirds, leading lines, balance, intentional negative space), " +
  "a cohesive and pleasing colour palette with rich but natural colour, flattering light (soft, golden " +
  "hour, or moody done well), a clear subject or strong sense of place with an editorial magazine-like " +
  "feel, and an overall vibe that would stop a scroll. Penalise cluttered or messy framing, muddy or " +
  "clashing colour, flat or unflattering light, harsh flash, accidental-looking blur or noise, and " +
  "generic snapshots with no point of interest.";

export const LINKEDIN_DEFAULT =
  "Judge this photo as a professional LinkedIn headshot. Reward one clearly-focused person as the " +
  "subject, natural eye contact and an approachable expression, head and shoulders framing that is " +
  "neither too far nor too tight, even flattering light with no harsh shadows or blowout, a clean " +
  "non-distracting background, and professional or smart-casual attire. Penalise casual group shots, " +
  "full-body or distant framing, no clear face, busy backgrounds, and poor lighting.";

export const PROFILE_CONTEXT =
  "Judge this photo as an all-purpose profile picture or avatar. Reward one clear well-lit face looking " +
  "toward the camera, tight head and shoulders framing that crops cleanly to a circle, a friendly " +
  "natural expression, and a simple uncluttered background. Penalise multiple people, distant or " +
  "full-body shots, obscured or side-turned faces, heavy shadows, and busy backgrounds.";

export const DEFAULT_CONTEXTS: Record<EditablePlatform, string> = {
  instagram: INSTAGRAM_DEFAULT,
  linkedin: LINKEDIN_DEFAULT,
};

export function isPlatform(v: string): v is Platform {
  return (PLATFORMS as readonly string[]).includes(v);
}

export function isEditablePlatform(v: string): v is EditablePlatform {
  return (EDITABLE_PLATFORMS as readonly string[]).includes(v);
}

export function defaultContext(platform: Platform): string {
  return platform === "profile" ? PROFILE_CONTEXT : DEFAULT_CONTEXTS[platform];
}

export function getRankingContext(db: BetterSQLite3Database<any>, platform: Platform): string {
  if (!isEditablePlatform(platform)) return defaultContext(platform);
  const row = db.select().from(rankingContexts).where(eq(rankingContexts.platform, platform)).all()[0];
  return row?.text ?? defaultContext(platform);
}

export function setRankingContext(db: BetterSQLite3Database<any>, platform: EditablePlatform, text: string): void {
  const now = Date.now();
  db.insert(rankingContexts)
    .values({ platform, text, updatedAt: now })
    .onConflictDoUpdate({ target: rankingContexts.platform, set: { text, updatedAt: now } })
    .run();
}

export function resetRankingContext(db: BetterSQLite3Database<any>, platform: EditablePlatform): void {
  db.delete(rankingContexts).where(eq(rankingContexts.platform, platform)).run();
}
```

- [ ] **Step 6: Re-export from the core barrel**

In `packages/core/src/index.ts`, add (near the other `export * from` lines):
```ts
export * from "./ranking-context.js";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm -w @event-editor/core test -- ranking-context`
Expected: PASS (6 tests).

- [ ] **Step 8: Rebuild core + run the full core suite**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/core test`
Expected: build succeeds; whole core suite green (existing `migrate`/`schema`/`drift` tests still pass with the new table + column).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/schema/index.ts packages/core/src/migrate.ts \
  packages/core/src/ranking-context.ts packages/core/src/index.ts \
  packages/core/test/ranking-context.test.ts
git commit -m "feat(core): ranking_contexts table + per-platform context module"
```

---

### Task 2: Core rank.ts — context-driven prompt + Instagram-lenient heuristics

**Files:**
- Modify: `packages/core/src/rank.ts`
- Test: `packages/core/test/rank.test.ts` (add cases)

**Interfaces:**
- Consumes: `type Platform` from `./ranking-context.js` (type-only import — no runtime cycle).
- Produces:
  - `buildVisionPrompt(name: string, context: string): string`
  - `HEURISTICS_LENIENT` const
  - `scoreHeuristics(m: ImageMetrics, platform?: Platform): HeuristicVerdict` (default `"linkedin"`)

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/rank.test.ts`, add (keep existing tests):
```ts
import { buildVisionPrompt, scoreHeuristics } from "../src/rank.js";

describe("buildVisionPrompt (context-driven)", () => {
  it("embeds the photo name and the given context", () => {
    const p = buildVisionPrompt("beach.jpg", "MY_CONTEXT_MARKER");
    expect(p).toContain("beach.jpg");
    expect(p).toContain("MY_CONTEXT_MARKER");
    expect(p).toContain("0 to 100");
  });
});

describe("scoreHeuristics platform leniency", () => {
  const dark = { width: 1200, height: 1200, sharpness: 40, brightness: 20, aspectRatio: 1 };
  it("rejects a dark, soft photo under the strict (linkedin) profile", () => {
    expect(scoreHeuristics(dark, "linkedin").rejected).toBe(true);
    // default arg is also strict
    expect(scoreHeuristics(dark).rejected).toBe(true);
  });
  it("accepts the same photo under the instagram lenient profile", () => {
    expect(scoreHeuristics(dark, "instagram").rejected).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core test -- rank`
Expected: FAIL — `buildVisionPrompt` arity / `scoreHeuristics` second arg not yet supported (marker/leniency assertions fail).

- [ ] **Step 3: Rewrite the prompt + heuristics in `rank.ts`**

Add a type-only import at the top of `packages/core/src/rank.ts`:
```ts
import type { Platform } from "./ranking-context.js";
```
Add the lenient heuristics const next to `HEURISTICS`:
```ts
export const HEURISTICS_LENIENT = {
  minLongEdge: 256,
  minSharpness: 25,
  brightnessMin: 12,
  brightnessMax: 248,
  aspectMin: 0.5,
  aspectMax: 2.0,
} as const;
```
Replace `scoreHeuristics` with a platform-aware version (generic reject copy, no "headshot crop" wording):
```ts
export function scoreHeuristics(m: ImageMetrics, platform: Platform = "linkedin"): HeuristicVerdict {
  const H = platform === "instagram" ? HEURISTICS_LENIENT : HEURISTICS;
  const longEdge = Math.max(m.width, m.height);
  if (longEdge < H.minLongEdge) {
    return { rejected: true, reason: `Low resolution (${m.width}x${m.height})` };
  }
  if (m.sharpness < H.minSharpness) {
    return { rejected: true, reason: "Looks blurry or out of focus" };
  }
  if (m.brightness < H.brightnessMin) {
    return { rejected: true, reason: "Too dark / underexposed" };
  }
  if (m.brightness > H.brightnessMax) {
    return { rejected: true, reason: "Too bright / blown out" };
  }
  if (m.aspectRatio < H.aspectMin || m.aspectRatio > H.aspectMax) {
    return { rejected: true, reason: "Awkward crop shape" };
  }
  return { rejected: false, reason: null };
}
```
Replace `buildVisionPrompt` with the context-driven version:
```ts
export function buildVisionPrompt(name: string, context: string): string {
  return [
    `You are screening one candidate photo ("${name}").`,
    context,
    `Score it from 0 to 100 on how well it fits, then give 1 to 3 short reasons (each under 12 words).`,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/core test -- rank`
Expected: PASS (new + existing rank tests; existing single-arg `scoreHeuristics(m)` calls still pass via the default).

- [ ] **Step 5: Rebuild core + full core suite**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/core test`
Expected: build ok; full core suite green.

Note: `packages/web` tsc is now temporarily red at `anthropic.ts` (`buildVisionPrompt(img.name)` is missing the new `context` arg). Expected — Task 4 fixes it.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/rank.ts packages/core/test/rank.test.ts
git commit -m "feat(core): context-driven vision prompt + instagram-lenient heuristics"
```

---

### Task 3: Core — thread platform through ranking + createScanJob

**Files:**
- Modify: `packages/core/src/ranking.ts` (`runRanking` platform param)
- Modify: `packages/core/src/ingest.ts` (`createScanJob` platform)
- Test: `packages/core/test/ranking.test.ts` and `packages/core/test/ingest.test.ts` (add cases)

**Interfaces:**
- Consumes: `scoreHeuristics(m, platform)` (Task 2); `type Platform` (Task 1).
- Produces:
  - `runRanking(db, jobId, deps, platform?: Platform)` (default `"linkedin"`)
  - `createScanJob(db, { driveFolderId, driveFolderName, platform? })` writes `jobs.platform` (default `"linkedin"`)

- [ ] **Step 1: Write the failing test for createScanJob**

In `packages/core/test/ingest.test.ts`, add (keep existing tests):
```ts
import { jobs } from "../src/index.js";
import { eq } from "drizzle-orm";

describe("createScanJob platform", () => {
  it("persists the given platform on the job row", () => {
    const db = freshDb(); // reuse the file's existing freshDb helper
    const id = createScanJob(db, { driveFolderId: "f", driveFolderName: "F", platform: "instagram" });
    const row = db.select().from(jobs).where(eq(jobs.id, id)).all()[0];
    expect(row.platform).toBe("instagram");
  });
  it("defaults platform to linkedin when omitted", () => {
    const db = freshDb();
    const id = createScanJob(db, { driveFolderId: "f", driveFolderName: "F" });
    const row = db.select().from(jobs).where(eq(jobs.id, id)).all()[0];
    expect(row.platform).toBe("linkedin");
  });
});
```
(If `ingest.test.ts` has no `freshDb` helper, add the standard one: `openDb(join(tmpdir(), \`ee-ing-${Math.random().toString(36).slice(2)}.db\`))` + `runMigrations`, importing `openDb`, `runMigrations`, `createScanJob` from `../src/index.js`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core test -- ingest`
Expected: FAIL — `platform` not accepted / `row.platform` undefined.

- [ ] **Step 3: Update `createScanJob`**

In `packages/core/src/ingest.ts`, change the signature + insert:
```ts
export function createScanJob(
  db: BetterSQLite3Database<any>,
  args: { driveFolderId: string; driveFolderName: string; platform?: string },
): number {
  const now = Date.now();
  const res = db
    .insert(jobs)
    .values({
      driveFolderId: args.driveFolderId,
      driveFolderName: args.driveFolderName,
      platform: args.platform ?? "linkedin",
      status: "scanning",
      total: 0,
      processed: 0,
      createdAt: now,
      updatedAt: now,
    })
```
(Leave the rest of the function body unchanged.)

- [ ] **Step 4: Update `runRanking` to take platform**

In `packages/core/src/ranking.ts`, change the signature and the heuristics call:
```ts
export async function runRanking(
  db: BetterSQLite3Database<any>,
  jobId: number,
  deps: RankingDeps,
  platform: Platform = "linkedin",
): Promise<void> {
```
Add the import at the top:
```ts
import type { Platform } from "./ranking-context.js";
```
And change the heuristics line inside the loop from `scoreHeuristics(m)` to:
```ts
        const verdict = scoreHeuristics(m, platform);
```

- [ ] **Step 5: (If `ranking.test.ts` asserts heuristics) add a leniency pass-through test**

In `packages/core/test/ranking.test.ts`, add a test that a dark survivor is rejected under default but survives to the vision pass under `"instagram"`. Use the file's existing fake-deps pattern; if the existing test builds `deps` with a `getMetrics` returning fixed metrics, add:
```ts
it("uses lenient heuristics for instagram", async () => {
  // metrics that fail strict brightness/sharpness but pass lenient
  const deps = makeDeps({ metrics: { width: 1200, height: 1200, sharpness: 40, brightness: 20, aspectRatio: 1 }, score: 88 });
  const jobId = seedJobWithOnePendingPhoto(db); // reuse the file's existing seeding helper
  await runRanking(db, jobId, deps, "instagram");
  const photo = db.select().from(photos).where(eq(photos.jobId, jobId)).all()[0];
  expect(photo.stage).toBe("ranked");
});
```
If `ranking.test.ts` has no reusable `makeDeps`/seed helpers, SKIP this step (the leniency logic is already unit-tested in Task 2's `scoreHeuristics` test); note the skip in the report. Do not invent brittle scaffolding.

- [ ] **Step 6: Run tests**

Run: `npm -w @event-editor/core test -- ingest ranking`
Expected: PASS (new createScanJob cases; existing 3-arg `runRanking` calls still pass via the default param).

- [ ] **Step 7: Rebuild core + full core suite**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/core test`
Expected: build ok; full core suite green.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/ranking.ts packages/core/src/ingest.ts \
  packages/core/test/ingest.test.ts packages/core/test/ranking.test.ts
git commit -m "feat(core): thread platform through runRanking + createScanJob"
```

---

### Task 4: Web wiring — scorePhoto(context), startScan(platform), sorter route

**Files:**
- Modify: `packages/web/lib/anthropic.ts` (`scorePhoto` gains `context`)
- Modify: `packages/web/lib/sorter.ts` (`startScan` gains `platform`, fetches context)
- Modify: `packages/web/app/api/sorter/jobs/route.ts` (read/validate `platform`)

**Interfaces:**
- Consumes: `getRankingContext`, `isPlatform`, `type Platform` (Task 1); `buildVisionPrompt(name, context)` (Task 2); `startScan(..., { platform })` (this task).
- Produces: `scorePhoto(client, img, context: string)`; `startScan(db, drive, { folderId, folderName, platform })`.

- [ ] **Step 1: Update `scorePhoto` to take context**

In `packages/web/lib/anthropic.ts`, change the signature + the text block:
```ts
export async function scorePhoto(
  client: Anthropic,
  img: { base64: string; mediaType: string; name: string },
  context: string,
): Promise<VisionScore> {
```
and inside the `content` array change the text part to:
```ts
          { type: "text", text: buildVisionPrompt(img.name, context) },
```

- [ ] **Step 2: Update `startScan` to thread platform + context**

In `packages/web/lib/sorter.ts`:
- Add imports:
  ```ts
  import { getRankingContext, type Platform } from "@event-editor/core/ranking-context";
  ```
- Change the signature:
  ```ts
  export function startScan(
    db: Db,
    drive: DriveClient,
    args: { folderId: string; folderName: string; platform: Platform },
  ): number {
    const jobId = createScanJob(db, { driveFolderId: args.folderId, driveFolderName: args.folderName, platform: args.platform });
  ```
- Just before the `runRanking` call (after the `visionClient()` line), read the context:
  ```ts
    const context = getRankingContext(db, args.platform);
  ```
- Change the `runRanking` call to pass context into `scorePhoto` and platform as the 4th arg:
  ```ts
    await runRanking(db, jobId, {
      getMetrics: (photo) => computeMetrics(resolve(photo.thumbnailPath!)),
      scoreVision: async (photo) => {
        const bytes = await readFile(resolve(photo.thumbnailPath!));
        return withBackoff(() =>
          scorePhoto(client, { base64: bytes.toString("base64"), mediaType: "image/jpeg", name: photo.name }, context),
        );
      },
    }, args.platform);
  ```

- [ ] **Step 3: Read + validate platform in the sorter route**

In `packages/web/app/api/sorter/jobs/route.ts`:
```ts
import { NextResponse } from "next/server";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { getDb } from "@/lib/db";
import { startScan } from "@/lib/sorter";
import { isPlatform, type Platform } from "@event-editor/core/ranking-context";

export async function POST(request: Request) {
  const { folderId, folderName, platform } = await request.json();
  if (!folderId) return NextResponse.json({ error: "folderId required" }, { status: 400 });
  const plat: Platform = typeof platform === "string" && isPlatform(platform) ? platform : "linkedin";
  const drive = await authedDriveClient(getDb());
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const jobId = startScan(getDb(), makeDriveClient(drive), { folderId, folderName: folderName ?? "(folder)", platform: plat });
  return NextResponse.json({ jobId });
}
```

- [ ] **Step 4: Rebuild core (for the subpath export) + typecheck web**

Run: `npm -w @event-editor/core run build` then, from `packages/web`, `npx tsc --noEmit`
Expected: web tsc back to the 5 pre-existing errors ONLY — the `buildVisionPrompt`/`scorePhoto`/`startScan` call sites now line up. Confirm `@event-editor/core/ranking-context` resolves as a subpath (core must be built first).

- [ ] **Step 5: Run the web suite**

Run (from `packages/web`): `npm test`
Expected: existing web tests green (this task adds no web unit tests; it is wiring verified by tsc).

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/anthropic.ts packages/web/lib/sorter.ts \
  packages/web/app/api/sorter/jobs/route.ts
git commit -m "feat(web): thread platform + ranking context into the sorter scan"
```

---

### Task 5: Sorter platform toggle (SorterClient)

**Files:**
- Modify: `packages/web/app/sorter/SorterClient.tsx`

**Interfaces:**
- Consumes: the `/api/sorter/jobs` POST now accepts `platform` (Task 4).

- [ ] **Step 1: Add platform state + include it in the scan POST**

In `packages/web/app/sorter/SorterClient.tsx`:
- Add state near the other `useState` calls:
  ```ts
  const [platform, setPlatform] = useState<"instagram" | "linkedin" | "profile">("linkedin");
  ```
- In `scan()`, change the POST body to include platform:
  ```ts
        body: JSON.stringify({ folderId, folderName: folder?.name, platform }),
  ```

- [ ] **Step 2: Render a neutral segmented toggle above the Scan button**

In the pre-scan JSX (the block with the folder `<select>` and the "Scan folder" button), add, directly above the row that holds the Scan button:
```tsx
        <div className="mb-3">
          <span className="mb-1.5 block text-sm text-muted">Rank photos for</span>
          <div className="inline-flex rounded-lg border border-line bg-[#eef0f3] p-0.5">
            {([
              { id: "instagram", label: "Instagram" },
              { id: "linkedin", label: "LinkedIn" },
              { id: "profile", label: "Profile picture" },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPlatform(opt.id)}
                disabled={busy}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  platform === opt.id ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
```
(Grey track, active segment raised on `bg-surface` with soft shadow, no accent stripe — matches the house toggle look. Disabled while `busy`.)

- [ ] **Step 3: Typecheck**

Run (from `packages/web`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verify**

Run (from `packages/web`): `npm run dev`, open `/sorter`. The toggle shows three options, defaults to LinkedIn, is disabled while a scan runs, and the selected value posts with the scan. Do not leave a dev server running.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/sorter/SorterClient.tsx
git commit -m "feat(web): sorter platform toggle (instagram/linkedin/profile)"
```

---

### Task 6: Editable ranking contexts in Settings

**Files:**
- Create: `packages/web/app/api/ranking-context/route.ts`
- Create: `packages/web/app/settings/RankingContexts.tsx`
- Modify: `packages/web/app/settings/page.tsx` (render the section)

**Interfaces:**
- Consumes: `getRankingContext`, `setRankingContext`, `resetRankingContext`, `isEditablePlatform`, `DEFAULT_CONTEXTS` (Task 1); `getDb` from `@/lib/db`.

- [ ] **Step 1: Write the route**

Create `packages/web/app/api/ranking-context/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getRankingContext,
  setRankingContext,
  resetRankingContext,
  isEditablePlatform,
  DEFAULT_CONTEXTS,
} from "@event-editor/core/ranking-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  return NextResponse.json({
    instagram: getRankingContext(db, "instagram"),
    linkedin: getRankingContext(db, "linkedin"),
    defaults: { instagram: DEFAULT_CONTEXTS.instagram, linkedin: DEFAULT_CONTEXTS.linkedin },
  });
}

export async function PUT(request: Request) {
  const { platform, text } = await request.json();
  if (typeof platform !== "string" || !isEditablePlatform(platform)) {
    return NextResponse.json({ error: "invalid platform" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  setRankingContext(getDb(), platform, text.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const platform = new URL(request.url).searchParams.get("platform") ?? "";
  if (!isEditablePlatform(platform)) {
    return NextResponse.json({ error: "invalid platform" }, { status: 400 });
  }
  resetRankingContext(getDb(), platform);
  return NextResponse.json({ text: getRankingContext(getDb(), platform) });
}
```

- [ ] **Step 2: Write the client component**

Create `packages/web/app/settings/RankingContexts.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";

type Data = { instagram: string; linkedin: string; defaults: { instagram: string; linkedin: string } };
const PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
] as const;
type PlatformId = (typeof PLATFORMS)[number]["id"];

export function RankingContexts() {
  const [data, setData] = useState<Data | null>(null);
  const [text, setText] = useState<Record<PlatformId, string>>({ instagram: "", linkedin: "" });
  const [status, setStatus] = useState<Record<PlatformId, string>>({ instagram: "", linkedin: "" });

  useEffect(() => {
    fetch("/api/ranking-context").then(async (r) => {
      const d: Data = await r.json();
      setData(d);
      setText({ instagram: d.instagram, linkedin: d.linkedin });
    });
  }, []);

  async function save(p: PlatformId) {
    setStatus((s) => ({ ...s, [p]: "Saving" }));
    const r = await fetch("/api/ranking-context", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: p, text: text[p] }),
    });
    setStatus((s) => ({ ...s, [p]: r.ok ? "Saved" : "Save failed" }));
  }

  async function reset(p: PlatformId) {
    const r = await fetch(`/api/ranking-context?platform=${p}`, { method: "DELETE" });
    if (r.ok) {
      const { text: restored } = await r.json();
      setText((t) => ({ ...t, [p]: restored }));
      setStatus((s) => ({ ...s, [p]: "Reset to default" }));
    }
  }

  if (!data) return <p className="mt-4 text-sm text-muted">Loading…</p>;

  return (
    <div className="mt-4 space-y-6">
      {PLATFORMS.map((p) => (
        <div key={p.id}>
          <label className="mb-1 block text-sm font-medium text-ink">{p.label}</label>
          <textarea
            className="field min-h-28 w-full"
            value={text[p.id]}
            onChange={(e) => {
              const v = e.target.value;
              setText((t) => ({ ...t, [p.id]: v }));
              setStatus((s) => ({ ...s, [p.id]: "" }));
            }}
          />
          <div className="mt-2 flex items-center gap-3">
            <button type="button" className="btn btn-accent" onClick={() => save(p.id)}>Save</button>
            <button type="button" className="btn" onClick={() => reset(p.id)}>Reset to default</button>
            {status[p.id] && <span className="text-sm text-muted">{status[p.id]}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Render the section in Settings**

In `packages/web/app/settings/page.tsx`:
- Add the import near the others: `import { RankingContexts } from "./RankingContexts";`
- Add a new section before the "Draft style and inspiration" heading (around line 72):
  ```tsx
  <h2 className="mt-10 text-lg font-semibold">Photo ranking</h2>
  <p className="mt-1 text-sm text-muted">Tune what the photo sorter looks for on each platform.</p>
  <RankingContexts />
  ```

- [ ] **Step 4: Typecheck**

Run (from `packages/web`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual verify**

Run (from `packages/web`): `npm run dev`, open `/settings`. The "Photo ranking" section loads Instagram + LinkedIn textareas pre-filled with the current effective text. Save shows "Saved"; Reset restores the default and shows "Reset to default". Do not leave a dev server running.

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/api/ranking-context/route.ts \
  packages/web/app/settings/RankingContexts.tsx packages/web/app/settings/page.tsx
git commit -m "feat(web): editable instagram/linkedin ranking contexts in settings"
```

---

### Task 7: Connection status pills

**Files:**
- Create: `packages/web/app/settings/ConnectionPills.tsx`
- Modify: `packages/web/app/settings/page.tsx` (compute readiness + render pills)

**Interfaces:**
- Consumes: `getConnections()` (already imported in page.tsx), `getToken(getDb(), "google"/"canva")` (already imported).

- [ ] **Step 1: Write the pills component**

Create `packages/web/app/settings/ConnectionPills.tsx`:
```tsx
export type PillState = { id: string; label: string; ready: boolean };

export function ConnectionPills({ items }: { items: PillState[] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.map((it) => (
        <span
          key={it.id}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ring-1 ${
            it.ready
              ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
              : "bg-amber-50 text-amber-700 ring-amber-600/20"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${it.ready ? "bg-emerald-500" : "bg-amber-500"}`} />
          {it.label} {it.ready ? "connected" : "needs setup"}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Compute readiness + render in page.tsx**

In `packages/web/app/settings/page.tsx`, inside `SettingsBody` after the existing token reads (`googleToken`, `canvaToken`), build the pill list. The connection ids are `"google" | "anthropic" | "canva" | "groq"`; use the existing `connections` array for `configured` and the tokens for OAuth state:
```tsx
  const byId = Object.fromEntries(connections.map((c) => [c.id, c.configured]));
  const pills = [
    { id: "groq", label: "Groq", ready: !!byId["groq"] },
    { id: "anthropic", label: "Claude", ready: !!byId["anthropic"] },
    { id: "google", label: "Google", ready: !!byId["google"] && googleToken !== null },
    { id: "canva", label: "Canva", ready: canvaConfigured && canvaToken !== null },
  ];
```
Then add the import `import { ConnectionPills } from "./ConnectionPills";` and render it right under the `<h1>`:
```tsx
      <h1 className="mt-1 text-2xl font-semibold">Settings</h1>
      <ConnectionPills items={pills} />
```
(`canvaConfigured` and `canvaToken` already exist in this component; `googleToken` already exists.)

- [ ] **Step 3: Typecheck**

Run (from `packages/web`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verify**

Run (from `packages/web`): `npm run dev`, open `/settings`. Pills appear under the heading: services with keys/tokens present are green "connected"; the rest are amber "needs setup". Google/Canva read amber until their OAuth is connected even if the client id/secret are set. Do not leave a dev server running.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/settings/ConnectionPills.tsx packages/web/app/settings/page.tsx
git commit -m "feat(web): settings connection status pills"
```

---

### Task 8: Per-provider API key guides

**Files:**
- Create: `packages/web/app/settings/key-guides.ts`
- Modify: `packages/web/app/settings/KeyForm.tsx` (render the guide under each legend)

**Interfaces:**
- Consumes: nothing new. `KeyForm`'s existing `GROUPS` titles are the guide keys: `"Claude (Anthropic)"`, `"Groq (transcription)"`, `"Google"`, `"Canva"`.

- [ ] **Step 1: Write the static guide content**

Create `packages/web/app/settings/key-guides.ts`:
```ts
export type Guide = { steps: string[] } | { note: string };

export const KEY_GUIDES: Record<string, Guide> = {
  "Claude (Anthropic)": { note: "Ask Caleb for help." },
  "Groq (transcription)": {
    steps: [
      "Go to console.groq.com and sign in.",
      "Open API Keys in the left menu.",
      "Click Create API Key and give it a name.",
      "Copy the key (it starts with gsk_) and paste it below. Groq shows it once.",
    ],
  },
  Google: {
    steps: [
      "Open console.cloud.google.com and create or pick a project.",
      "In APIs and Services, Library, enable the Google Drive API and the Google Sheets API.",
      "In APIs and Services, OAuth consent screen, set it up as External and add your own email as a test user.",
      "In APIs and Services, Credentials, choose Create credentials, OAuth client ID, Web application.",
      "Under Authorized redirect URIs add both http://localhost:3000/api/google/callback and http://localhost:3001/api/google/callback (the app uses 3001 if 3000 is taken).",
      "Copy the Client ID and Client secret into the fields below.",
    ],
  },
  Canva: {
    steps: [
      "Go to canva.com/developers and sign in.",
      "Create an integration under Your integrations, Create an integration.",
      "In Configuration, Add redirect URL, add http://127.0.0.1:3000/api/canva/callback. Use 127.0.0.1, not localhost, Canva rejects localhost.",
      "In Scopes, enable design content read and write and asset read.",
      "Copy the Client ID, generate a Client secret, and paste both below.",
    ],
  },
};
```

- [ ] **Step 2: Render the guide in KeyForm**

In `packages/web/app/settings/KeyForm.tsx`:
- Add the import: `import { KEY_GUIDES } from "./key-guides";`
- Inside the `GROUPS.map((g) => ( ... ))`, right after the `<legend>…</legend>` line, insert a collapsible guide. Bind the guide to a local const so `in`-narrowing works cleanly:
```tsx
            {(() => {
              const guide = KEY_GUIDES[g.title];
              if (!guide) return null;
              return (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-muted hover:text-ink">How to get this</summary>
                  <div className="mt-2 text-muted">
                    {"note" in guide ? (
                      <p>{guide.note}</p>
                    ) : (
                      <ol className="list-decimal space-y-1 pl-5">
                        {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
                      </ol>
                    )}
                  </div>
                </details>
              );
            })()}
```

- [ ] **Step 3: Typecheck**

Run (from `packages/web`): `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verify**

Run (from `packages/web`): `npm run dev`, open `/settings`. Each provider group shows a "How to get this" toggle. Groq, Google, Canva expand to numbered steps; Claude (Anthropic) shows "Ask Caleb for help." Do not leave a dev server running.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/settings/key-guides.ts packages/web/app/settings/KeyForm.tsx
git commit -m "feat(web): per-provider api key setup guides"
```

---

## Self-review notes

- **Spec coverage:** A1 pills → Task 7; A2 guides → Task 8; B1 table+module → Task 1; B2 prompt+heuristics → Task 2; B3 threading → Tasks 3+4; B4 toggle → Task 5; B5 editable contexts → Task 6. All spec sections covered.
- **Type consistency:** `Platform`/`EditablePlatform`, `getRankingContext`/`setRankingContext`/`resetRankingContext`, `isPlatform`/`isEditablePlatform`, `buildVisionPrompt(name, context)`, `scoreHeuristics(m, platform)`, `runRanking(..., platform)`, `createScanJob({..., platform})`, `startScan({..., platform})`, `scorePhoto(..., context)` — used identically across tasks.
- **Staged breakage is intentional and flagged:** web tsc is red between Task 2 and Task 4; core vitest gates those tasks; Task 4 restores web tsc.
- **Anti-vibecode:** pills use semantic emerald/amber for meaning only; sorter toggle stays neutral grey; no em dashes in any guide/UI copy; reuses `.field`/`.btn`/`.card`.
- **DB safety:** `jobs.platform` added via `addColumnIfMissing` (safe on existing DBs); `ranking_contexts` via `CREATE TABLE IF NOT EXISTS`; both idempotent.
