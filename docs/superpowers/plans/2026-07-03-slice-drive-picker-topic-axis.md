# Slice: Drive Picker + Topic Axis + Leak Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the slide slicer a native Google Drive file picker, a topic/section slicing axis alongside speaker mode, and fix the empty-temp-dir leak in the convert route.

**Architecture:** Three independent slices of the same feature. (1) A `GET /api/drive/token` route vends a short-lived OAuth access token + picker config from the already-stored Google creds; the client opens the native `google.picker` widget and drops the chosen file id into the existing `driveFileId` field. (2) A `buildTopicSegmentPrompt` + `segmentByTopic` pair mirrors the speaker path; the `/api/slice/segment` route dispatches on a `by` param; the client adds a third "By topic" mode. (3) The convert route hoists all early validation above `mkdir` so 400s stop orphaning dirs.

**Tech Stack:** Next.js App Router (Node runtime), TypeScript, Vitest, `@event-editor/core` (compiled to `dist`, imported by subpath), Anthropic SDK, `google.picker` browser widget, googleapis OAuth2.

## Global Constraints

- Test runner is **Vitest**; run with `npm -w @event-editor/core run test` and `npm -w @event-editor/web run test` (both are `vitest run`).
- **Rebuild core after editing it:** web imports `@event-editor/core/pptx` from `dist`, so run `npm -w @event-editor/core run build` before any web code or web test consumes new core exports.
- Web tests live in `packages/web/test/*.test.ts` (NOT under `app/`, to avoid Next treating them as route files). The `@` alias resolves to the `packages/web` root (see `packages/web/vitest.config.ts`).
- Core tests live in `packages/core/test/*.test.ts` and import from `../src/*.js` (Vitest runs the TS source directly; no build needed for core tests).
- All API routes keep `export const runtime = "nodejs";`.
- **No em dashes** in any UI copy or user-facing string (house rule).
- UI reuses existing house classes (`btn`, `field`, `bg-raised text-ink shadow-raisededge`, `text-muted`, `border-line`); do not invent new visual treatments.
- Commit after each task. This is Caleb's repo: the final task pushes `main`.

---

## File Structure

**Create:**
- `packages/web/app/api/drive/token/route.ts` — vends OAuth access token + picker config.
- `packages/web/test/convert-route.test.ts` — leak-fix regression test.
- `packages/web/test/segment-route.test.ts` — `by` dispatch test.
- `packages/web/test/drive-token-route.test.ts` — token route tests.
- `docs/setup/drive-picker.md` — Cloud console + env setup steps.

**Modify:**
- `packages/web/app/api/slice/convert/route.ts` — hoist validation above `mkdir`.
- `packages/core/src/pptx.ts` — add `buildTopicSegmentPrompt`; add `labelPrefix` param to `normalizeSpeakerGroups`.
- `packages/core/test/pptx.test.ts` — tests for the two core changes.
- `packages/web/lib/anthropic.ts` — add `segmentByTopic`; import `buildTopicSegmentPrompt`.
- `packages/web/app/api/slice/segment/route.ts` — accept + dispatch on `by`.
- `packages/web/lib/google/oauth.ts` — add `googleAccessToken` helper.
- `packages/web/app/slice/SliceClient.tsx` — third mode + picker button.

---

### Task 1: Convert route — fix the empty-dir leak

The bug: `mkdir(dir)` runs (currently ~line 27) *before* the `driveFileId` / `x-filename` / `empty body` / `not connected` 400 checks (~lines 33-45). Those early returns bypass the `catch` that calls `cleanupRun`, so each leaves an empty `data/slice/<runId>/`. Fix: validate everything cheap first, create the dir only once we're committed to doing work.

**Files:**
- Modify: `packages/web/app/api/slice/convert/route.ts`
- Test: `packages/web/test/convert-route.test.ts` (create)

**Interfaces:**
- Consumes: `newRunId`, `runDir`, `deckPath`, `masterPdfPath`, `cleanupRun`, `sweepOldRuns` from `@/lib/slice`; `findSoffice`, `convertToPdf`, `readSlides` from `@/lib/pptx-convert`; `authedDriveClient`, `makeDriveClient`, `getDb`.
- Produces: unchanged response contract `{ runId, pageCount, slides, filename, warnings }`; unchanged request contract (JSON `{driveFileId}` or stream + `x-filename` header).

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/convert-route.test.ts`:

```ts
import { vi, describe, it, expect } from "vitest";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

// Mock LibreOffice + conversion so the test never shells out and deterministically
// reaches the driveFileId validation.
vi.mock("@/lib/pptx-convert", () => ({
  findSoffice: () => "/usr/bin/soffice",
  convertToPdf: vi.fn(),
  readSlides: vi.fn(),
}));

import { POST } from "@/app/api/slice/convert/route";

async function sliceEntries(): Promise<string[]> {
  try {
    return await readdir(resolve("data/slice"));
  } catch {
    return [];
  }
}

describe("convert route validation ordering", () => {
  it("returns 400 and creates no run dir when driveFileId is missing", async () => {
    const before = await sliceEntries();
    const req = new Request("http://x/api/slice/convert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const after = await sliceEntries();
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- convert-route`
Expected: FAIL — after the missing-`driveFileId` 400, `data/slice` has a new orphaned entry, so `after` differs from `before`.

- [ ] **Step 3: Rewrite the route so validation precedes `mkdir`**

Replace the body of `POST` in `packages/web/app/api/slice/convert/route.ts` with:

```ts
export async function POST(request: Request) {
  if (!findSoffice()) {
    return NextResponse.json({ error: "LibreOffice is not installed. See the tool page for install steps." }, { status: 400 });
  }

  // Validate everything cheap BEFORE creating the run dir, so early 400s never leak a dir.
  const ct = request.headers.get("content-type") ?? "";
  let driveFileId: string | null = null;
  let filename = "deck.pptx";
  if (ct.includes("application/json")) {
    const body = (await request.json()) as { driveFileId?: string };
    driveFileId = body?.driveFileId ?? null;
    if (!driveFileId) return NextResponse.json({ error: "driveFileId required" }, { status: 400 });
  } else {
    const raw = request.headers.get("x-filename");
    if (!raw) return NextResponse.json({ error: "x-filename header required" }, { status: 400 });
    if (!request.body) return NextResponse.json({ error: "empty body" }, { status: 400 });
    filename = safeName(raw);
  }

  // Drive connection is a validation too — check it before we create anything.
  let drive: Awaited<ReturnType<typeof authedDriveClient>> = null;
  if (driveFileId) {
    drive = await authedDriveClient(getDb());
    if (!drive) return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });
  }

  const runId = newRunId();
  const dir = runDir(runId);
  await mkdir(dir, { recursive: true });
  try { await sweepOldRuns(6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  const pptx = deckPath(runId);

  try {
    if (driveFileId) {
      const bytes = await makeDriveClient(drive!).downloadFile(driveFileId);
      await writeFile(pptx, bytes);
    } else {
      await pipeline(Readable.fromWeb(request.body as any), createWriteStream(pptx));
    }

    await convertToPdf(pptx, dir);
    const slides = await readSlides(pptx);
    const pageCount = await pdfPageCount(await readFile(masterPdfPath(runId)));

    const warnings: string[] = [];
    if (slides.length !== pageCount) {
      warnings.push(`This deck has ${slides.length} slides but the PDF has ${pageCount} pages, so slide numbers may not line up with page numbers. Double-check your ranges.`);
    }
    return NextResponse.json({ runId, pageCount, slides, filename, warnings });
  } catch (err) {
    try { await cleanupRun(runId); } catch { /* best-effort */ }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

Leave the imports and `safeName` helper at the top of the file unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- convert-route`
Expected: PASS — 400 returned and `data/slice` entry set is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/api/slice/convert/route.ts packages/web/test/convert-route.test.ts
git commit -m "fix(slice): validate before mkdir so early 400s stop leaking temp dirs"
```

---

### Task 2: Core — topic prompt + prefix-aware normalize

**Files:**
- Modify: `packages/core/src/pptx.ts`
- Test: `packages/core/test/pptx.test.ts`

**Interfaces:**
- Consumes: existing `SlideText` (`{ index, text, notes }`) and `SpeakerGroup` (`{ speaker, startSlide, endSlide }`) from `packages/core/src/pptx.ts`.
- Produces:
  - `buildTopicSegmentPrompt(slides: SlideText[]): string`
  - `normalizeSpeakerGroups(groups: SpeakerGroup[], slideCount: number, labelPrefix?: string): SpeakerGroup[]` — new optional third arg, defaults to `"Speaker"` (backward compatible).

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/pptx.test.ts`, add `buildTopicSegmentPrompt` to the existing import from `../src/pptx.js`, then append:

```ts
describe("buildTopicSegmentPrompt", () => {
  it("frames topics, states the slide count, and includes slide bodies and notes", () => {
    const slides = [
      { index: 1, text: "Welcome", notes: "" },
      { index: 2, text: "Revenue", notes: "up 20%" },
    ];
    const p = buildTopicSegmentPrompt(slides);
    expect(p).toContain("topic sections");
    expect(p).toContain("covering slides 1 to 2");
    expect(p).toContain("Slide 1: Welcome");
    expect(p).toContain("Notes: up 20%");
  });
});

describe("normalizeSpeakerGroups labelPrefix", () => {
  it("names blank labels with the supplied prefix", () => {
    const out = normalizeSpeakerGroups([{ speaker: "", startSlide: 1, endSlide: 2 }], 3, "Section");
    expect(out[0].speaker).toBe("Section 1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w @event-editor/core run test -- pptx`
Expected: FAIL — `buildTopicSegmentPrompt` is not exported; the prefix test gets `"Speaker 1"`.

- [ ] **Step 3: Implement in `packages/core/src/pptx.ts`**

Add `buildTopicSegmentPrompt` (place it next to `buildSpeakerSegmentPrompt`):

```ts
export function buildTopicSegmentPrompt(slides: SlideText[]): string {
  const body = slides
    .map((s) => {
      const notes = s.notes ? `\n  Notes: ${s.notes}` : "";
      return `Slide ${s.index}: ${s.text || "(no visible text)"}${notes}`;
    })
    .join("\n");
  return [
    "You are segmenting a slide deck into its distinct topic sections.",
    "Read the slide text and speaker notes below. Group consecutive slides that cover the same topic into one section.",
    "Rules:",
    "- Sections must be contiguous and non-overlapping, covering slides 1 to " + slides.length + " in order.",
    "- Label each section with a short topic title (for example \"Market overview\", \"Q and A\").",
    "- Return startSlide and endSlide as 1-based slide numbers.",
    "",
    body,
  ].join("\n");
}
```

Then change the `normalizeSpeakerGroups` signature and blank-fill line to accept a prefix:

```ts
export function normalizeSpeakerGroups(groups: SpeakerGroup[], slideCount: number, labelPrefix = "Speaker"): SpeakerGroup[] {
  const clamp = (n: number) => Math.max(1, Math.min(Math.round(n), slideCount));
  const out = groups.map((g) => {
    let s = clamp(g.startSlide);
    let e = clamp(g.endSlide);
    if (s > e) [s, e] = [e, s];
    return { speaker: g.speaker.trim(), startSlide: s, endSlide: e };
  });
  out.sort((a, b) => a.startSlide - b.startSlide);
  return out.map((g, i) => ({ ...g, speaker: g.speaker || `${labelPrefix} ${i + 1}` }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w @event-editor/core run test -- pptx`
Expected: PASS — including the pre-existing `normalizeSpeakerGroups` test (unchanged default behavior).

- [ ] **Step 5: Rebuild core so `dist` carries the new exports**

Run: `npm -w @event-editor/core run build`
Expected: `tsc` completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pptx.ts packages/core/test/pptx.test.ts packages/core/dist
git commit -m "feat(core): topic segment prompt + prefix-aware normalizeSpeakerGroups"
```

---

### Task 3: Server — `segmentByTopic` + `by` dispatch on the segment route

**Files:**
- Modify: `packages/web/lib/anthropic.ts`
- Modify: `packages/web/app/api/slice/segment/route.ts`
- Test: `packages/web/test/segment-route.test.ts` (create)

**Interfaces:**
- Consumes: `buildTopicSegmentPrompt`, `normalizeSpeakerGroups`, `SlideText`, `SpeakerGroup` from `@event-editor/core/pptx`; `SEGMENT_SCHEMA`, `SUMMARY_MODEL`, `visionClient` (existing in `anthropic.ts`).
- Produces:
  - `segmentByTopic(client: Anthropic, slides: SlideText[]): Promise<SpeakerGroup[]>` in `anthropic.ts`.
  - `/api/slice/segment` POST now accepts `{ slides: SlideText[]; by?: "speaker" | "topic" }`; `by` defaults to `"speaker"`. Response unchanged: `{ groups }`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/segment-route.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";

const segmentSpeakers = vi.fn(async () => [{ speaker: "A", startSlide: 1, endSlide: 1 }]);
const segmentByTopic = vi.fn(async () => [{ speaker: "T", startSlide: 1, endSlide: 1 }]);

vi.mock("@/lib/anthropic", () => ({
  visionClient: () => ({}),
  segmentSpeakers,
  segmentByTopic,
}));

import { POST } from "@/app/api/slice/segment/route";

const slides = [{ index: 1, text: "x", notes: "" }];

function req(body: unknown) {
  return new Request("http://x/api/slice/segment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test";
});

describe("segment route dispatch", () => {
  it("routes to segmentByTopic when by=topic", async () => {
    const res = await POST(req({ slides, by: "topic" }));
    expect(res.status).toBe(200);
    expect(segmentByTopic).toHaveBeenCalledOnce();
    expect(segmentSpeakers).not.toHaveBeenCalled();
  });

  it("defaults to segmentSpeakers", async () => {
    const res = await POST(req({ slides }));
    expect(res.status).toBe(200);
    expect(segmentSpeakers).toHaveBeenCalledOnce();
    expect(segmentByTopic).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- segment-route`
Expected: FAIL — the mock factory references `segmentByTopic`, which the route does not yet import (module load / dispatch fails).

- [ ] **Step 3: Add `segmentByTopic` to `packages/web/lib/anthropic.ts`**

Extend the core/pptx import to include `buildTopicSegmentPrompt`:

```ts
import { buildSpeakerSegmentPrompt, buildTopicSegmentPrompt, normalizeSpeakerGroups, type SlideText, type SpeakerGroup } from "@event-editor/core/pptx";
```

Add the function next to `segmentSpeakers`:

```ts
export async function segmentByTopic(client: Anthropic, slides: SlideText[]): Promise<SpeakerGroup[]> {
  const res: any = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 2048,
    output_config: { format: { type: "json_schema", schema: SEGMENT_SCHEMA } },
    messages: [{ role: "user", content: [{ type: "text", text: buildTopicSegmentPrompt(slides) }] }],
  } as any);
  if (res.stop_reason === "refusal") throw new Error("model refused to segment the deck");
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as { groups: SpeakerGroup[] };
  return normalizeSpeakerGroups(parsed.groups, slides.length, "Section");
}
```

- [ ] **Step 4: Dispatch on `by` in `packages/web/app/api/slice/segment/route.ts`**

Update the import and the body:

```ts
import { visionClient, segmentSpeakers, segmentByTopic } from "@/lib/anthropic";
```

Inside the `try`, replace the `slides` destructure + `segmentSpeakers` call with:

```ts
    const { slides, by } = (await request.json()) as { slides: SlideText[]; by?: "speaker" | "topic" };
    if (!Array.isArray(slides) || slides.length === 0) {
      return NextResponse.json({ error: "slides required" }, { status: 400 });
    }
    const groups = by === "topic"
      ? await segmentByTopic(visionClient(), slides)
      : await segmentSpeakers(visionClient(), slides);
    return NextResponse.json({ groups });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- segment-route`
Expected: PASS — both dispatch cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/anthropic.ts packages/web/app/api/slice/segment/route.ts packages/web/test/segment-route.test.ts
git commit -m "feat(slice): segmentByTopic + by-param dispatch on segment route"
```

---

### Task 4: Client — add the "By topic" mode

**Files:**
- Modify: `packages/web/app/slice/SliceClient.tsx`

**Interfaces:**
- Consumes: `/api/slice/segment` now accepting `by` (Task 3).
- Produces: no new exports; UI-only wiring. `mode` state type widens to `"manual" | "speaker" | "topic"`.

- [ ] **Step 1: Widen the mode state**

Change the `mode` state declaration:

```ts
  const [mode, setMode] = useState<"manual" | "speaker" | "topic">("manual");
```

- [ ] **Step 2: Send the axis from `segment()`**

In `segment()`, change the fetch body to include `by`:

```ts
      const r = await fetch("/api/slice/segment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slides, by: mode === "topic" ? "topic" : "speaker" }),
      });
```

- [ ] **Step 3: Add the third segmented-control button**

In the mode segmented control, after the existing "By speaker" button, add:

```tsx
              <button type="button" onClick={() => setMode("topic")}
                className={`rounded-md px-3 py-1.5 text-sm ${mode === "topic" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}>
                By topic
              </button>
```

- [ ] **Step 4: Show the suggest button for both AI modes**

Change the block currently gated on `{mode === "speaker" && (` to gate on either AI mode, and vary the button label. The wrapper condition becomes `{(mode === "speaker" || mode === "topic") && (` and the button label becomes:

```tsx
              {status === "segmenting"
                ? "Finding portions…"
                : mode === "topic"
                  ? "Suggest topic sections"
                  : "Suggest speaker portions"}
```

(Leave the `disabled={busy || !hasAi}` and `onClick={segment}` as they are.)

- [ ] **Step 5: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/slice/SliceClient.tsx
git commit -m "feat(slice): add By topic slicing mode to the UI"
```

- [ ] **Step 7: Manual note**

The topic mode is verified end-to-end in the final manual pass (Task 6, Step 8): with a real deck loaded, clicking "By topic" then "Suggest topic sections" should populate rows labeled by section title.

---

### Task 5: Token route + Cloud setup docs

**Files:**
- Modify: `packages/web/lib/google/oauth.ts`
- Create: `packages/web/app/api/drive/token/route.ts`
- Create: `packages/web/test/drive-token-route.test.ts`
- Create: `docs/setup/drive-picker.md`

**Interfaces:**
- Consumes: existing `makeOAuthClient`, `getToken`, `saveToken`, `openDb` already imported in `oauth.ts`; `getDb` from `@/lib/db`.
- Produces:
  - `googleAccessToken(db): Promise<{ token: string; expiresAt: number | null } | null>` in `oauth.ts`.
  - `GET /api/drive/token` → `200 { access_token, expires_at, apiKey, appId }` when configured + connected; `400 { error }` otherwise.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/test/drive-token-route.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const googleAccessToken = vi.fn();
vi.mock("@/lib/google/oauth", () => ({ googleAccessToken }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { GET } from "@/app/api/drive/token/route";

const OLD = { ...process.env };
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  process.env = { ...OLD };
});

describe("GET /api/drive/token", () => {
  it("400 when picker env is not configured", async () => {
    delete process.env.GOOGLE_PICKER_API_KEY;
    delete process.env.GOOGLE_PICKER_APP_ID;
    const res = await GET();
    expect(res.status).toBe(400);
    expect(googleAccessToken).not.toHaveBeenCalled();
  });

  it("400 when Google is not connected", async () => {
    process.env.GOOGLE_PICKER_API_KEY = "k";
    process.env.GOOGLE_PICKER_APP_ID = "123";
    googleAccessToken.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(400);
  });

  it("200 with token and config when connected", async () => {
    process.env.GOOGLE_PICKER_API_KEY = "k";
    process.env.GOOGLE_PICKER_APP_ID = "123";
    googleAccessToken.mockResolvedValue({ token: "ya29.x", expiresAt: 999 });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "ya29.x", expires_at: 999, apiKey: "k", appId: "123" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- drive-token-route`
Expected: FAIL — the route module does not exist yet.

- [ ] **Step 3: Add the `googleAccessToken` helper to `packages/web/lib/google/oauth.ts`**

Add next to `authedDriveClient` (it reuses the same imports — `makeOAuthClient`, `getToken`, `saveToken`, `openDb`):

```ts
export async function googleAccessToken(
  db: ReturnType<typeof openDb>,
): Promise<{ token: string; expiresAt: number | null } | null> {
  const stored = getToken(db, "google");
  if (!stored) return null;
  const client = makeOAuthClient();
  client.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken ?? undefined,
    expiry_date: stored.expiryMs ?? undefined,
  });
  client.on("tokens", (t) => {
    saveToken(db, "google", {
      accessToken: t.access_token ?? stored.accessToken,
      refreshToken: t.refresh_token ?? null,
      expiryMs: t.expiry_date ?? null,
      scope: t.scope ?? null,
    });
  });
  const res = await client.getAccessToken();
  if (!res.token) return null;
  return { token: res.token, expiresAt: client.credentials.expiry_date ?? null };
}
```

- [ ] **Step 4: Create `packages/web/app/api/drive/token/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { googleAccessToken } from "@/lib/google/oauth";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.GOOGLE_PICKER_API_KEY;
  const appId = process.env.GOOGLE_PICKER_APP_ID;
  if (!apiKey || !appId) {
    return NextResponse.json(
      { error: "Drive picker is not configured. Set GOOGLE_PICKER_API_KEY and GOOGLE_PICKER_APP_ID." },
      { status: 400 },
    );
  }
  const tok = await googleAccessToken(getDb());
  if (!tok) {
    return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });
  }
  return NextResponse.json({ access_token: tok.token, expires_at: tok.expiresAt, apiKey, appId });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- drive-token-route`
Expected: PASS — all three cases green.

- [ ] **Step 6: Write the setup doc**

Create `docs/setup/drive-picker.md`:

```markdown
# Google Drive picker setup

The slice tool's "Choose from Drive" button uses the native Google Picker. It needs
two values from the same Google Cloud project your OAuth client already lives in.

## 1. Enable the Picker API
Google Cloud Console -> APIs & Services -> Library -> search "Google Picker API" -> Enable.

## 2. Create a browser API key
APIs & Services -> Credentials -> Create credentials -> API key. Restrict it to the
Picker API (Application restrictions: HTTP referrers -> add your app origin, e.g.
`http://localhost:3000/*`). Copy the key.

## 3. Find the project number
Cloud Console home / project settings -> "Project number" (a long integer). This is
the picker App ID.

## 4. Set env vars (root `.env`)
```
GOOGLE_PICKER_API_KEY=your_browser_api_key
GOOGLE_PICKER_APP_ID=your_project_number
```

The access token itself is minted server-side from the Google account you already
connected on the settings page. No extra consent popup is required. If either env var
is missing, `GET /api/drive/token` returns 400 and the picker button surfaces that
message.
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/lib/google/oauth.ts packages/web/app/api/drive/token/route.ts packages/web/test/drive-token-route.test.ts docs/setup/drive-picker.md
git commit -m "feat(slice): drive token route + picker setup docs"
```

---

### Task 6: Client — native Google Picker button

**Files:**
- Modify: `packages/web/app/slice/SliceClient.tsx`

**Interfaces:**
- Consumes: `GET /api/drive/token` (Task 5); the `google.picker` widget loaded from `https://apis.google.com/js/api.js`.
- Produces: no new exports. The picked file's id flows into the existing `driveFileId` state, which `convert` already consumes. New `pickedName` state holds the display label.

- [ ] **Step 1: Add `pickedName` state**

Next to the `driveFileId` state:

```ts
  const [pickedName, setPickedName] = useState<string | null>(null);
```

- [ ] **Step 2: Add the loader + open helpers**

Inside the component (above the `return`), add:

```ts
  function loadGapiPicker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = window as any;
      if (w.google?.picker) return resolve();
      const onload = () => w.gapi.load("picker", { callback: () => resolve() });
      const existing = document.getElementById("gapi-js") as HTMLScriptElement | null;
      if (existing) { onload(); return; }
      const s = document.createElement("script");
      s.id = "gapi-js";
      s.src = "https://apis.google.com/js/api.js";
      s.onload = onload;
      s.onerror = () => reject(new Error("Failed to load the Google Picker"));
      document.body.appendChild(s);
    });
  }

  async function chooseFromDrive() {
    setError(null);
    try {
      const r = await fetch("/api/drive/token");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not open the Drive picker");
      await loadGapiPicker();
      const w = window as any;
      const view = new w.google.picker.DocsView(w.google.picker.ViewId.DOCS)
        .setMimeTypes("application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint")
        .setIncludeFolders(true);
      const picker = new w.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(data.access_token)
        .setDeveloperKey(data.apiKey)
        .setAppId(data.appId)
        .setCallback((res: any) => {
          if (res.action === w.google.picker.Action.PICKED) {
            const doc = res.docs?.[0];
            if (doc) {
              setDriveFileId(doc.id);
              setPickedName(doc.name ?? doc.id);
            }
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
```

- [ ] **Step 3: Replace the raw Drive-id field with the picker button + fallback**

Replace the existing block (the `<label>Or a Google Drive file id ...</label>` plus its helper `<p>`) with:

```tsx
        <div className="mt-3">
          <button type="button" className="btn" onClick={chooseFromDrive}>
            {pickedName ? "Change Drive file" : "Choose from Drive"}
          </button>
          {pickedName && <span className="ml-2 text-sm text-muted">{pickedName}</span>}
          <p className="mt-1 text-xs text-muted">Uses your connected Google account. Or drop a file above.</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted">Paste a Drive file id instead</summary>
            <input
              className="field mt-1 w-full max-w-md"
              placeholder="Drive .pptx file id"
              value={driveFileId}
              onChange={(e) => { setDriveFileId(e.target.value); setPickedName(null); }}
            />
          </details>
        </div>
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no type errors (the `google`/`gapi` globals are reached via `window as any`, so no `@types/gapi` is needed).

- [ ] **Step 5: Full test sweep**

Run: `npm -w @event-editor/core run test && npm -w @event-editor/web run test`
Expected: all green (existing suite + the three new web tests + the two new core tests).

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/slice/SliceClient.tsx
git commit -m "feat(slice): native Google Drive picker replaces the raw file-id field"
```

- [ ] **Step 7: Push**

```bash
git push origin main
```

- [ ] **Step 8: Manual verification (browser)**

With `GOOGLE_PICKER_API_KEY` / `GOOGLE_PICKER_APP_ID` set and Google connected, `npm run dev`, open `/slice`:
1. Click "Choose from Drive" — the native Google picker opens, filtered to .pptx; pick a deck; its name shows next to the button.
2. Convert, then switch mode to "By topic" and click "Suggest topic sections" — rows populate with section titles.
3. Confirm "By speaker" still works unchanged.
4. Expand "Paste a Drive file id instead" — the fallback input still accepts a raw id.

---

## Self-Review

**Spec coverage:**
- Native Google Picker (server-vended token) → Tasks 5 (token route + helper + docs) and 6 (picker UI). ✓
- Config `GOOGLE_PICKER_API_KEY` / `GOOGLE_PICKER_APP_ID` returned via token route → Task 5. ✓
- Topic/section axis (core prompt, `segmentByTopic`, `by` dispatch, third mode button) → Tasks 2, 3, 4. ✓
- Empty-dir leak (validate before mkdir) → Task 1. ✓
- Testing: topic segmentation unit test (Task 2), token route connected/not-connected (Task 5), leak "no dir after 400" (Task 1); picker manual-only (Task 6). ✓
- Out-of-scope items (folder nav beyond native picker, multi-file, token down-scoping) — not planned. ✓

**Placeholder scan:** No TBD/TODO/"add error handling" — every code step is complete. ✓

**Type consistency:** `normalizeSpeakerGroups(groups, slideCount, labelPrefix?)` defined in Task 2, called with `"Section"` in Task 3 and unchanged (2-arg) by the existing speaker path. `googleAccessToken(db) → { token, expiresAt } | null` defined in Task 5 Step 3, consumed by the route in Step 4 and mocked identically in Step 1. `segmentByTopic(client, slides)` defined in Task 3 Step 3, imported by the route in Step 4, mocked in Step 1. Token route response `{ access_token, expires_at, apiKey, appId }` matches the client's `data.access_token`/`data.apiKey`/`data.appId` reads in Task 6. ✓
