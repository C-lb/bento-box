# Tool Requirement Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Bento tool grid, dim and block any tool whose API keys or external packages aren't configured on this machine, showing an amber exclamation badge that deep-links to the right Settings section.

**Architecture:** A real runtime check — `GET /api/health` reports which API keys are present (via existing `getConnections()`) and which binaries are installed (via existing `dependencyStatuses()`). Each tool declares its hard requirements in a new `requires` field. A pure resolver maps (tool, health) → readiness. `ToolGrid` fetches health once and passes readiness to `ToolCard`, which dims the body and renders a badge when a tool isn't ready.

**Tech Stack:** Next.js (App Router), React client components, TypeScript, Tailwind, Lucide icons, Vitest.

## Global Constraints

- Test runner: `npm test` in `packages/web` = `vitest run`. Pure-logic tests live in `packages/web/test/`.
- Amber warning styling only (`amber-50` / `amber-700` / `ring-amber-600/20`), never a red/danger tone. Flat fill, dim `ring-1` stroke, no shine. Matches `ConnectionPills`.
- Icons: inline Lucide SVG only. No `ti-*` webfont glyphs.
- Copy: sentence case, no em dashes. Badge/tooltip text pattern: `Feature not available: needs <X>`.
- Fail-open: if health is unknown (loading or fetch error), render every card as ready. A health problem must never block all tools.
- Core imports use subpath form: `@event-editor/core/settings`.

---

### Task 1: Extend `/api/health` to report API-key presence

**Files:**
- Modify: `packages/web/lib/deps.ts` (add `DepId` export)
- Modify: `packages/web/app/api/health/route.ts`
- Test: `packages/web/test/health-route.test.ts` (create)

**Interfaces:**
- Consumes: `getConnections(env?)` from `@event-editor/core/settings` (returns `{ id: ConnectionId; label: string; configured: boolean }[]`); `dependencyStatuses()` from `@/lib/deps`.
- Produces: `DepId` type export from `@/lib/deps`; `GET /api/health` JSON now includes `keys: { id: ConnectionId; configured: boolean }[]` alongside existing `deps`.

- [ ] **Step 1: Add the `DepId` export to `lib/deps.ts`**

Directly under the existing `Dep` interface (line ~76, which has `id: "ffmpeg" | "ytdlp" | "libreoffice";`), add:

```ts
export type DepId = Dep["id"];
```

- [ ] **Step 2: Write the failing test**

Create `packages/web/test/health-route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns a keys entry per connection with correct configured flags", async () => {
    process.env.GROQ_API_KEY = "gsk_test";
    const res = await GET();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.keys)).toBe(true);
    const groq = body.keys.find((k: { id: string }) => k.id === "groq");
    const anthropic = body.keys.find((k: { id: string }) => k.id === "anthropic");
    expect(groq.configured).toBe(true);
    expect(anthropic.configured).toBe(false);
    expect(Array.isArray(body.deps)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd packages/web && npx vitest run test/health-route.test.ts`
Expected: FAIL — `body.keys` is `undefined` (route doesn't return `keys` yet).

- [ ] **Step 4: Add `keys` to the route**

Rewrite `packages/web/app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";
import { dependencyStatuses } from "@/lib/deps";
import { getConnections } from "@event-editor/core/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const deps = await dependencyStatuses();
  const keys = getConnections().map((c) => ({ id: c.id, configured: c.configured }));
  return NextResponse.json({
    ok: true,
    deps: deps.map((d) => ({ id: d.id, ready: d.ready, version: d.version })),
    keys,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/web && npx vitest run test/health-route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/deps.ts packages/web/app/api/health/route.ts packages/web/test/health-route.test.ts
git commit -m "feat(health): report API-key presence from /api/health"
```

---

### Task 2: Requirement metadata on the `Tool` type

**Files:**
- Modify: `packages/web/components/tools.ts`

**Interfaces:**
- Consumes: `ConnectionId` from `@event-editor/core/settings`; `DepId` from `@/lib/deps`.
- Produces: `Tool.requires?: { keys?: ConnectionId[]; deps?: DepId[] }`, populated on sorter/studio/transcribe/slice.

- [ ] **Step 1: Import the id types**

At the top of `packages/web/components/tools.ts`, alongside the existing lucide import, add:

```ts
import type { ConnectionId } from "@event-editor/core/settings";
import type { DepId } from "@/lib/deps";
```

- [ ] **Step 2: Add the field to the `Tool` type**

In the `export type Tool = { ... }` block, add the field after `tags`:

```ts
  requires?: { keys?: ConnectionId[]; deps?: DepId[] };
```

- [ ] **Step 3: Annotate the four hard-requirement tools**

Add a `requires` field to these entries in `TOOLS` (match by `id`; leave every other tool untouched — bundled/client-only tools stay unblocked, and `convert` is intentionally left unblocked so its file→mp3 mode keeps working without yt-dlp):

```ts
// id: "sorter"
requires: { keys: ["google", "anthropic"] },
// id: "studio"
requires: { keys: ["google", "canva"] },
// id: "transcribe"
requires: { keys: ["groq", "anthropic", "google"] },
// id: "slice"
requires: { keys: ["anthropic"], deps: ["libreoffice"] },
```

> If a tool's real id differs (e.g. `headshot` instead of `studio`), match the existing `id` values in the file — do not rename anything.

- [ ] **Step 4: Verify it typechecks**

Run: `cd packages/web && npx tsc --noEmit`
Expected: no NEW errors referencing `tools.ts` (the repo has ~5 pre-existing tsc errors elsewhere; those are unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/tools.ts
git commit -m "feat(tools): declare per-tool API-key and package requirements"
```

---

### Task 3: `toolReadiness` resolver + labels

**Files:**
- Create: `packages/web/components/tool-readiness.ts`
- Test: `packages/web/test/tool-readiness.test.ts`

**Interfaces:**
- Consumes: `Tool` from `@/components/tools`; `ConnectionId` from `@event-editor/core/settings`; `DepId` from `@/lib/deps`.
- Produces:
  - `type Health = { deps: { id: DepId; ready: boolean }[]; keys: { id: ConnectionId; configured: boolean }[] }`
  - `type Readiness = { ready: boolean; missingKeys: ConnectionId[]; missingDeps: DepId[] }`
  - `toolReadiness(tool: Tool, health: Health): Readiness`
  - `requirementTooltip(r: Readiness): string` — the `Feature not available: needs ...` string
  - `settingsHref(r: Readiness): string` — `/settings#api-keys` if any key missing, else `/settings#dependencies`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/tool-readiness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Tool } from "@/components/tools";
import {
  toolReadiness,
  requirementTooltip,
  settingsHref,
  type Health,
} from "@/components/tool-readiness";

const base: Tool = {
  id: "x", href: "/x", title: "X", body: "b",
  Icon: (() => null) as unknown as Tool["Icon"],
  defaultGroups: [], tags: [],
};

const health: Health = {
  keys: [
    { id: "groq", configured: false },
    { id: "anthropic", configured: true },
    { id: "google", configured: true },
    { id: "canva", configured: false },
  ],
  deps: [
    { id: "ffmpeg", ready: true },
    { id: "ytdlp", ready: false },
    { id: "libreoffice", ready: false },
  ],
};

describe("toolReadiness", () => {
  it("is ready when the tool has no requirements", () => {
    expect(toolReadiness(base, health).ready).toBe(true);
  });

  it("is ready when all required keys are configured", () => {
    const t = { ...base, requires: { keys: ["anthropic", "google"] as const } };
    expect(toolReadiness(t as Tool, health).ready).toBe(true);
  });

  it("blocks when a required key is missing", () => {
    const t = { ...base, requires: { keys: ["groq"] as const } };
    const r = toolReadiness(t as Tool, health);
    expect(r.ready).toBe(false);
    expect(r.missingKeys).toEqual(["groq"]);
  });

  it("blocks when a required dep is missing", () => {
    const t = { ...base, requires: { deps: ["libreoffice"] as const } };
    const r = toolReadiness(t as Tool, health);
    expect(r.ready).toBe(false);
    expect(r.missingDeps).toEqual(["libreoffice"]);
  });

  it("reports both missing keys and deps", () => {
    const t = { ...base, requires: { keys: ["groq"] as const, deps: ["libreoffice"] as const } };
    const r = toolReadiness(t as Tool, health);
    expect(r.ready).toBe(false);
    expect(r.missingKeys).toEqual(["groq"]);
    expect(r.missingDeps).toEqual(["libreoffice"]);
  });

  it("ignores unknown ids (treats as satisfied)", () => {
    const t = { ...base, requires: { keys: ["bogus"] as unknown as ConnectionIdArr } };
    expect(toolReadiness(t as Tool, health).ready).toBe(true);
  });

  it("builds a needs-X tooltip listing every missing item", () => {
    const r = { ready: false, missingKeys: ["groq"] as const, missingDeps: ["libreoffice"] as const };
    expect(requirementTooltip(r as never)).toBe(
      "Feature not available: needs Groq API key, LibreOffice",
    );
  });

  it("links to api-keys when a key is missing, else dependencies", () => {
    expect(settingsHref({ ready: false, missingKeys: ["groq"], missingDeps: [] } as never)).toBe("/settings#api-keys");
    expect(settingsHref({ ready: false, missingKeys: [], missingDeps: ["libreoffice"] } as never)).toBe("/settings#dependencies");
  });
});

type ConnectionIdArr = readonly string[];
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && npx vitest run test/tool-readiness.test.ts`
Expected: FAIL — cannot resolve `@/components/tool-readiness`.

- [ ] **Step 3: Write the resolver**

Create `packages/web/components/tool-readiness.ts`:

```ts
import type { Tool } from "@/components/tools";
import type { ConnectionId } from "@event-editor/core/settings";
import type { DepId } from "@/lib/deps";

export type Health = {
  deps: { id: DepId; ready: boolean }[];
  keys: { id: ConnectionId; configured: boolean }[];
};

export type Readiness = {
  ready: boolean;
  missingKeys: ConnectionId[];
  missingDeps: DepId[];
};

// Human labels for the tooltip. Keys use "<thing> API key" phrasing; deps use
// the product name. Unknown ids never reach here (filtered by the resolver).
const KEY_LABEL: Record<ConnectionId, string> = {
  groq: "Groq API key",
  anthropic: "Claude API key",
  google: "Google sign-in",
  canva: "Canva sign-in",
};

const DEP_LABEL: Record<DepId, string> = {
  ffmpeg: "FFmpeg",
  ytdlp: "yt-dlp",
  libreoffice: "LibreOffice",
};

export function toolReadiness(tool: Tool, health: Health): Readiness {
  const wantKeys = tool.requires?.keys ?? [];
  const wantDeps = tool.requires?.deps ?? [];

  const keyConfigured = new Map(health.keys.map((k) => [k.id, k.configured]));
  const depReady = new Map(health.deps.map((d) => [d.id, d.ready]));

  // A requirement counts as satisfied unless we positively know it is missing.
  // Unknown ids (not in the health map) are treated as satisfied so a typo
  // can never permanently block a tool.
  const missingKeys = wantKeys.filter((id) => keyConfigured.get(id) === false);
  const missingDeps = wantDeps.filter((id) => depReady.get(id) === false);

  return {
    ready: missingKeys.length === 0 && missingDeps.length === 0,
    missingKeys,
    missingDeps,
  };
}

export function requirementTooltip(r: Readiness): string {
  const parts = [
    ...r.missingKeys.map((id) => KEY_LABEL[id]),
    ...r.missingDeps.map((id) => DEP_LABEL[id]),
  ];
  return `Feature not available: needs ${parts.join(", ")}`;
}

export function settingsHref(r: Readiness): string {
  return r.missingKeys.length > 0 ? "/settings#api-keys" : "/settings#dependencies";
}
```

- [ ] **Step 4: Reconcile the tooltip label with the test**

The test expects `"needs Groq API key, LibreOffice"`. Confirm `KEY_LABEL.groq === "Groq API key"` and `DEP_LABEL.libreoffice === "LibreOffice"` (they do). If you change any label wording, update the test's expected string to match.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/web && npx vitest run test/tool-readiness.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 6: Commit**

```bash
git add packages/web/components/tool-readiness.ts packages/web/test/tool-readiness.test.ts
git commit -m "feat(tools): add toolReadiness resolver, labels, and deep-link helper"
```

---

### Task 4: Blocked-card UI + health fetch in the grid

**Files:**
- Create: `packages/web/components/RequirementBadge.tsx`
- Modify: `packages/web/components/ToolCard.tsx`
- Modify: `packages/web/components/ToolGrid.tsx`

**Interfaces:**
- Consumes: `toolReadiness`, `requirementTooltip`, `settingsHref`, `type Health` from `@/components/tool-readiness`.
- Produces: `<RequirementBadge readiness={...} />`; `ToolCard` accepts a new optional `readiness?: Readiness` prop; `ToolGrid` fetches `/api/health` and passes readiness per tool.

- [ ] **Step 1: Create the badge component**

Create `packages/web/components/RequirementBadge.tsx`:

```tsx
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { requirementTooltip, settingsHref, type Readiness } from "@/components/tool-readiness";

// Amber "needs setup" badge shown on a blocked tool card. It is the only
// interactive element on a blocked card: clicking it deep-links to the exact
// Settings section that fixes the tool. Flat amber, dim ring — matches
// ConnectionPills; never a red/danger tone.
export function RequirementBadge({ readiness }: { readiness: Readiness }) {
  const label = requirementTooltip(readiness);
  return (
    <Link
      href={settingsHref(readiness)}
      title={label}
      aria-label={label}
      className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-600/20 transition-colors hover:bg-amber-100"
    >
      <TriangleAlert size={13} strokeWidth={2} aria-hidden />
      Setup needed
    </Link>
  );
}
```

- [ ] **Step 2: Wire the blocked state into `ToolCard`**

Rewrite `packages/web/components/ToolCard.tsx` so it accepts `readiness` and, when not ready, replaces the `<Link>` with a non-navigating dimmed body plus the badge. Keep `CardMenu` live in both states.

```tsx
import Link from "next/link";
import type { Tool } from "@/components/tools";
import { getIllustration } from "@/components/tool-illustrations";
import { CardMenu } from "@/components/CardMenu";
import { RequirementBadge } from "@/components/RequirementBadge";
import type { Readiness } from "@/components/tool-readiness";

export function ToolCard({ tool, readiness }: { tool: Tool; readiness?: Readiness }) {
  const { Icon } = tool;
  const blocked = readiness ? !readiness.ready : false;

  const inner = (
    <>
      {/* Mobile: compact list row (icon tile + title + one-line body). */}
      <div className="flex min-h-[48px] items-center gap-3 pr-12 sm:hidden">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef0f3]">
          <Icon size={18} strokeWidth={1.75} className="text-ink" aria-hidden />
        </span>
        <span className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{tool.title}</h2>
          <p className="mt-0.5 line-clamp-1 text-sm text-muted">{tool.body}</p>
        </span>
      </div>

      {/* Desktop: full card with illustration, body, and tags. */}
      <div className="hidden sm:block">
        <div className="relative h-48 overflow-hidden rounded-2xl bg-[#eef0f3] p-4">{getIllustration(tool.id)}</div>
        <h2 className="mt-4 flex items-center gap-2 text-base font-semibold">
          <Icon size={18} strokeWidth={1.75} className="text-ink" aria-hidden />
          {tool.title}
        </h2>
        <p className="mt-1.5 text-[13px] text-muted">{tool.body}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {tool.tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded-md bg-[#eef0f3] px-1.5 py-0.5 text-[11px] text-muted">
              {t}
            </span>
          ))}
          {tool.tags.length > 4 && <span className="px-1 py-0.5 text-[11px] text-muted">+{tool.tags.length - 4}</span>}
        </div>
      </div>
    </>
  );

  return (
    <div className="group relative h-full rounded-[20px] border border-line bg-surface p-3 shadow-soft transition-colors hover:border-muted/40 sm:p-4">
      <CardMenu tool={tool} />
      {blocked && readiness && <RequirementBadge readiness={readiness} />}
      {blocked ? (
        <div
          aria-disabled="true"
          className="-m-3 block cursor-not-allowed p-3 opacity-45 sm:m-0 sm:p-0"
        >
          {inner}
        </div>
      ) : (
        <Link href={tool.href} className="-m-3 block p-3 sm:m-0 sm:p-0">
          {inner}
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Fetch health in `ToolGrid` and pass readiness**

Rewrite `packages/web/components/ToolGrid.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { TOOLS } from "@/components/tools";
import { visibleTools } from "@/components/tool-store";
import { useToolShell } from "@/components/tool-shell-context";
import { ToolCard } from "@/components/ToolCard";
import { toolReadiness, type Health } from "@/components/tool-readiness";

export function ToolGrid() {
  const { state, activeGroup, query } = useToolShell();
  const tools = visibleTools(state, TOOLS, activeGroup, query);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: Health) => {
        if (alive) setHealth(h);
      })
      .catch(() => {
        // Fail open: unknown health leaves every card clickable.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (tools.length === 0) {
    const msg = query.trim()
      ? `No tools match "${query.trim()}"`
      : "No tools in this group yet";
    return <p className="py-16 text-center text-sm text-muted">{msg}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} readiness={health ? toolReadiness(t, health) : undefined} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify build + typecheck**

Run: `cd packages/web && npx tsc --noEmit && npm run build`
Expected: build succeeds; no NEW tsc errors (pre-existing ones unchanged).

- [ ] **Step 5: Manual smoke (dev server)**

Run: `cd packages/web && npm run dev`, open `http://localhost:3000`.
With an unconfigured `.env`: sorter, studio, transcribe, slice show a "Setup needed" badge and are dimmed/non-clickable; every other tool (convert, video, qr, …) is normal and clickable. Hover a badge → tooltip. Click a badge → lands on `/settings#api-keys` (or `#dependencies` for slice's LibreOffice-only case if its key is set). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add packages/web/components/RequirementBadge.tsx packages/web/components/ToolCard.tsx packages/web/components/ToolGrid.tsx
git commit -m "feat(shell): block unconfigured tools with a setup-needed badge"
```

---

### Task 5: Settings deep-link anchors + highlight-on-hash

**Files:**
- Modify: `packages/web/app/settings/page.tsx`
- Create: `packages/web/app/settings/HashHighlight.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `id="api-keys"` and `id="dependencies"` anchors; `<HashHighlight />` client component that flashes the section named by `location.hash`.

- [ ] **Step 1: Add id anchors to the two headings**

In `packages/web/app/settings/page.tsx`, change the two `<h2>` lines:

```tsx
      <h2 id="api-keys" className="mt-8 scroll-mt-6 text-lg font-semibold">API keys</h2>
```

```tsx
      <h2 id="dependencies" className="mt-8 scroll-mt-6 text-lg font-semibold">Dependencies</h2>
```

(`scroll-mt-6` keeps the heading clear of the top edge when jumped to.)

- [ ] **Step 2: Create the highlight component**

Create `packages/web/app/settings/HashHighlight.tsx`:

```tsx
"use client";
import { useEffect } from "react";

// When Settings is opened via a deep link like /settings#api-keys, briefly
// ring the target heading so it's obvious where to look. No-op without a hash.
export function HashHighlight() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.classList.add("ring-2", "ring-amber-400", "rounded-md", "ring-offset-2");
    const t = setTimeout(() => {
      el.classList.remove("ring-2", "ring-amber-400", "rounded-md", "ring-offset-2");
    }, 1600);
    return () => clearTimeout(t);
  }, []);
  return null;
}
```

- [ ] **Step 3: Mount `HashHighlight` in the settings page**

In `packages/web/app/settings/page.tsx`, add the import at the top:

```tsx
import { HashHighlight } from "./HashHighlight";
```

and render it once inside the returned `<div>` (e.g. right after `<h1 ...>Settings</h1>`):

```tsx
      <HashHighlight />
```

- [ ] **Step 4: Verify build + typecheck**

Run: `cd packages/web && npx tsc --noEmit && npm run build`
Expected: build succeeds; no NEW tsc errors.

- [ ] **Step 5: Manual smoke**

Run `npm run dev`, open `http://localhost:3000/settings#api-keys` directly: the page scrolls to "API keys" and it flashes an amber ring for ~1.6s. Repeat with `#dependencies`. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/settings/page.tsx packages/web/app/settings/HashHighlight.tsx
git commit -m "feat(settings): deep-link anchors with highlight-on-hash"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full web test suite**

Run: `cd packages/web && npm test`
Expected: all tests pass, including the two new files (`test/health-route.test.ts`, `test/tool-readiness.test.ts`). Note the total count (was ~170).

- [ ] **Step 2: Typecheck the package**

Run: `cd packages/web && npx tsc --noEmit`
Expected: only the repo's pre-existing errors (~5), none in files touched by this plan.

- [ ] **Step 3: Commit any final fixes (if needed)**

```bash
git add -A
git commit -m "test: verify tool requirement badges suite green"
```

---

## Self-Review notes

- **Spec coverage:** metadata (Task 2), detection endpoint (Task 1), resolver (Task 3), blocked card + badge + grid fetch (Task 4), settings anchors + highlight (Task 5), tests across Tasks 1/3/6. Fail-open handled in Task 4 Step 3 and Task 3 (unknown-id → satisfied). convert/yt-dlp exception encoded in Task 2 Step 3.
- **Deep-link target:** `settingsHref` picks `#api-keys` when any key is missing, else `#dependencies` — matches spec.
- **Type consistency:** `Health`, `Readiness`, `toolReadiness`, `requirementTooltip`, `settingsHref` names identical across Tasks 3/4. `DepId` exported in Task 1, consumed in Tasks 2/3.
- **Open item for reviewer:** the convert/yt-dlp "leave unblocked" decision (spec §Architecture) — veto here if you'd rather block convert when yt-dlp is absent.
