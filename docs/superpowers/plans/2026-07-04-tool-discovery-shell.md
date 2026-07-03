# Tool Discovery Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat tool topbar and hardcoded home grid with a scalable discovery shell — grouped topbar (Favourites pinned), per-card favourite/group popovers, author tags, and a reveal-on-scroll tag search — built to hold all 13 tools while shipping against the current 5.

**Architecture:** All real logic lives in pure, unit-tested modules: a tool **registry** (`components/tools.ts`), a **store** of user state persisted to `localStorage` (`components/tool-store.ts`), and pure view-selectors (`visibleTools`, `searchTools`, `nextSearchVisibility`). React components (`Nav`, `ToolGrid`, `ToolCard`, `CardMenu`, `ToolSearch`, `GroupManager`) are thin wrappers that read a React context and call the pure functions. This mirrors the existing codebase, where `nav-anim.ts`/`nav-links.ts` hold tested logic and components stay declarative.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind, lucide-react, Vitest (node environment). No new runtime dependencies.

## Global Constraints

- Package: all paths under `packages/web`. Run commands from `~/event-editor/packages/web`.
- Test runner: `npx vitest run <file>` (node environment; no jsdom — do not write tests that render React).
- Import alias: `@/` resolves to `packages/web/` (configured in `vitest.config.ts` and tsconfig).
- Persistence: `localStorage` only. Single key `ee.toolShell`. Mirror the existing read/write/parse/event pattern from `components/nav-links.ts`.
- No randomness or `Date.now()` in stored-state logic — custom group ids are slugified from their label with a numeric dedupe suffix, so state is deterministic and testable.
- House design system (anti-vibecode): one accent over neutral greys, soft diffuse shadows, sentence-case labels (never ALL-CAPS), no em dashes in any copy, respect `prefers-reduced-motion`.
- Turbopack gotcha: import values from `.ts`/`.tsx` with explicit named exports; do not add path-extension-less re-export barrels.
- Commit after every task with the shown message.

---

## File Structure

**Create:**
- `components/tools.ts` — registry: `Tool` type, `TOOLS`, `toolById`, `searchTools`.
- `components/tool-store.ts` — `ToolShellState`, `FAV`, seed defaults, pure reducers, selectors, `localStorage` read/write/parse + change event.
- `components/tool-shell-context.tsx` — React context: hydrated state, `activeGroup`, `query`, dispatch wrappers.
- `components/tool-illustrations.tsx` — **modify** to add `getIllustration(id)`.
- `components/ToolGrid.tsx` — filters registry via context, renders cards + empty states.
- `components/CardMenu.tsx` — per-card popover (favourite, group checkboxes, new group).
- `components/ToolSearch.tsx` — reveal-on-scroll search bar.
- `components/GroupManager.tsx` — Settings group reorder/rename/delete/create.

**Modify:**
- `components/Nav.tsx` — group pills + thumb + Home logo + Settings gear.
- `components/ToolCard.tsx` — tag row + "⋯" menu button.
- `app/page.tsx` — thin, renders `<ToolGrid/>`.
- `app/layout.tsx` — wrap in provider, mount `<ToolSearch/>` under `<Nav/>`.
- `app/settings/page.tsx` — swap `<NavOrder/>` for `<GroupManager/>`.

**Delete (Task 10):**
- `components/nav-links.ts`, `test/nav-links.test.ts`, `app/settings/NavOrder.tsx` — superseded by the registry, store, and `GroupManager`.

---

## Task 1: Tool registry

**Files:**
- Create: `packages/web/components/tools.ts`
- Test: `packages/web/test/tools.test.ts`

**Interfaces:**
- Produces:
  - `type Tool = { id: string; href: string; title: string; body: string; Icon: LucideIcon; defaultGroups: string[]; tags: string[] }`
  - `const TOOLS: Tool[]`
  - `function toolById(id: string): Tool | undefined`
  - `function searchTools(tools: Tool[], query: string): Tool[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/tools.test.ts
import { describe, it, expect } from "vitest";
import { TOOLS, toolById, searchTools } from "@/components/tools";

const ids = (ts: { id: string }[]) => ts.map((t) => t.id);

describe("TOOLS registry", () => {
  it("has the five current tools with unique ids and hrefs", () => {
    expect(ids(TOOLS)).toEqual(["sorter", "studio", "transcribe", "slice", "convert"]);
    expect(new Set(ids(TOOLS)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.href)).size).toBe(TOOLS.length);
  });
  it("gives every tool at least one default group and one tag, all lowercase", () => {
    for (const t of TOOLS) {
      expect(t.defaultGroups.length).toBeGreaterThan(0);
      expect(t.tags.length).toBeGreaterThan(0);
      expect(t.tags.every((tag) => tag === tag.toLowerCase())).toBe(true);
    }
  });
});

describe("toolById", () => {
  it("finds a tool", () => {
    expect(toolById("slice")?.href).toBe("/slice");
  });
  it("returns undefined for an unknown id", () => {
    expect(toolById("nope")).toBeUndefined();
  });
});

describe("searchTools", () => {
  it("returns all tools for an empty or whitespace query", () => {
    expect(searchTools(TOOLS, "")).toHaveLength(TOOLS.length);
    expect(searchTools(TOOLS, "   ")).toHaveLength(TOOLS.length);
  });
  it("matches a tag", () => {
    expect(ids(searchTools(TOOLS, "mp3"))).toContain("convert");
  });
  it("matches the title", () => {
    expect(ids(searchTools(TOOLS, "headshot"))).toContain("studio");
  });
  it("matches the body text", () => {
    expect(ids(searchTools(TOOLS, "timestamped"))).toContain("transcribe");
  });
  it("is case-insensitive and trims", () => {
    expect(ids(searchTools(TOOLS, "  MP3 "))).toContain("convert");
  });
  it("returns registry order for matches", () => {
    const r = searchTools(TOOLS, "image");
    expect(ids(r)).toEqual(TOOLS.filter((t) => ids(r).includes(t.id)).map((t) => t.id));
  });
  it("returns empty for no match", () => {
    expect(searchTools(TOOLS, "zzzznomatch")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/event-editor/packages/web && npx vitest run test/tools.test.ts`
Expected: FAIL — cannot resolve `@/components/tools`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/components/tools.ts
import { Images, UserRound, Mic, Scissors, AudioLines, type LucideIcon } from "lucide-react";

export type Tool = {
  id: string;
  href: string;
  title: string;
  body: string;
  Icon: LucideIcon;
  defaultGroups: string[]; // group ids from tool-store DEFAULT_GROUP_ORDER (or custom later)
  tags: string[]; // lowercase, author-defined
};

export const TOOLS: Tool[] = [
  {
    id: "sorter",
    href: "/sorter",
    title: "Rank Drive photos",
    body: "Scan a Google Drive folder and rank each photo for headshot fitness, best first.",
    Icon: Images,
    defaultGroups: ["images", "events"],
    tags: ["rank", "drive", "headshot", "photo", "image"],
  },
  {
    id: "studio",
    href: "/studio",
    title: "Build a branded headshot",
    body: "Turn a Drive photo into a clean, on-brand headshot you can download in a click.",
    Icon: UserRound,
    defaultGroups: ["images", "events"],
    tags: ["headshot", "brand", "portrait", "image"],
  },
  {
    id: "transcribe",
    href: "/transcribe",
    title: "Transcribe to a Google Doc",
    body: "Upload a long recording and get a Doc with a summary and full timestamped transcript.",
    Icon: Mic,
    defaultGroups: ["media", "events"],
    tags: ["transcribe", "audio", "speech", "doc", "subtitle"],
  },
  {
    id: "slice",
    href: "/slice",
    title: "Slice a deck into PDFs",
    body: "Convert a deck to PDF, split it by page ranges, speaker, or topic, and stamp each page.",
    Icon: Scissors,
    defaultGroups: ["documents"],
    tags: ["pdf", "deck", "slides", "split", "stamp"],
  },
  {
    id: "convert",
    href: "/convert",
    title: "Convert audio to mp3",
    body: "Turn a YouTube or video link, or an uploaded audio or video file, into an mp3 you can name and download.",
    Icon: AudioLines,
    defaultGroups: ["media"],
    tags: ["audio", "mp3", "convert", "youtube", "video"],
  },
];

export function toolById(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}

export function searchTools(tools: Tool[], query: string): Tool[] {
  const q = query.trim().toLowerCase();
  if (!q) return tools;
  return tools.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.includes(q)),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/event-editor/packages/web && npx vitest run test/tools.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
cd ~/event-editor
git add packages/web/components/tools.ts packages/web/test/tools.test.ts
git commit -m "feat(web): tool registry with groups, tags, and search"
```

---

## Task 2: Store foundation — state, seed, selectors, persistence

**Files:**
- Create: `packages/web/components/tool-store.ts`
- Test: `packages/web/test/tool-store.test.ts`

**Interfaces:**
- Consumes: `Tool`, `TOOLS` from `@/components/tools`.
- Produces:
  - `const FAV = "fav"`
  - `const DEFAULT_GROUP_ORDER: string[]` and `const DEFAULT_GROUP_LABELS: Record<string,string>`
  - `type ToolShellState = { version: 1; groups: string[]; groupLabels: Record<string,string>; membership: Record<string,string[]>; favourites: string[] }`
  - `function seedState(): ToolShellState`
  - `function effectiveGroups(state: ToolShellState, tool: Tool): string[]`
  - `function toolsInGroup(state: ToolShellState, tools: Tool[], groupId: string): Tool[]`
  - `function visibleTools(state: ToolShellState, tools: Tool[], activeGroup: string, query: string): Tool[]`
  - `const TOOL_SHELL_KEY = "ee.toolShell"`, `const TOOL_SHELL_EVENT = "ee:tool-shell-change"`
  - `function parseToolShell(raw: string | null): ToolShellState`
  - `function readToolShell(): ToolShellState`
  - `function writeToolShell(state: ToolShellState): void`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/tool-store.test.ts
import { describe, it, expect } from "vitest";
import { TOOLS, toolById } from "@/components/tools";
import {
  FAV,
  DEFAULT_GROUP_ORDER,
  seedState,
  effectiveGroups,
  toolsInGroup,
  visibleTools,
  parseToolShell,
} from "@/components/tool-store";

const ids = (ts: { id: string }[]) => ts.map((t) => t.id);

describe("seedState", () => {
  it("seeds the four default groups in order with labels", () => {
    const s = seedState();
    expect(s.groups).toEqual(DEFAULT_GROUP_ORDER);
    expect(s.groupLabels.images).toBe("Images");
    expect(s.membership).toEqual({});
    expect(s.favourites).toEqual([]);
    expect(s.version).toBe(1);
  });
});

describe("effectiveGroups", () => {
  it("falls back to the tool's defaultGroups when no override", () => {
    const s = seedState();
    expect(effectiveGroups(s, toolById("sorter")!)).toEqual(["images", "events"]);
  });
  it("uses the membership override when present", () => {
    const s = { ...seedState(), membership: { sorter: ["events"] } };
    expect(effectiveGroups(s, toolById("sorter")!)).toEqual(["events"]);
  });
  it("drops group ids that no longer exist in state.groups", () => {
    const s = { ...seedState(), groups: ["images"], groupLabels: { images: "Images" } };
    expect(effectiveGroups(s, toolById("sorter")!)).toEqual(["images"]);
  });
});

describe("toolsInGroup", () => {
  it("returns tools whose effective groups include the id, in registry order", () => {
    const s = seedState();
    expect(ids(toolsInGroup(s, TOOLS, "images"))).toEqual(["sorter", "studio"]);
    expect(ids(toolsInGroup(s, TOOLS, "media"))).toEqual(["transcribe", "convert"]);
  });
});

describe("visibleTools", () => {
  it("shows favourites when the active group is FAV", () => {
    const s = { ...seedState(), favourites: ["convert", "slice"] };
    expect(ids(visibleTools(s, TOOLS, FAV, ""))).toEqual(["slice", "convert"]);
  });
  it("shows a group's tools when a group is active", () => {
    const s = seedState();
    expect(ids(visibleTools(s, TOOLS, "documents", ""))).toEqual(["slice"]);
  });
  it("a live query overrides the active group and searches all tools", () => {
    const s = seedState();
    expect(ids(visibleTools(s, TOOLS, "documents", "mp3"))).toEqual(["convert"]);
  });
});

describe("parseToolShell", () => {
  it("returns a seed for null", () => {
    expect(parseToolShell(null)).toEqual(seedState());
  });
  it("returns a seed for malformed JSON", () => {
    expect(parseToolShell("{not json")).toEqual(seedState());
  });
  it("returns a seed when the version is wrong", () => {
    expect(parseToolShell(JSON.stringify({ version: 99 }))).toEqual(seedState());
  });
  it("round-trips a valid state", () => {
    const s = { ...seedState(), favourites: ["slice"] };
    expect(parseToolShell(JSON.stringify(s))).toEqual(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/event-editor/packages/web && npx vitest run test/tool-store.test.ts`
Expected: FAIL — cannot resolve `@/components/tool-store`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/components/tool-store.ts
import { TOOLS, searchTools, type Tool } from "@/components/tools";

export const FAV = "fav"; // reserved favourites group id, always rendered first

export const DEFAULT_GROUP_ORDER = ["events", "images", "media", "documents"];
export const DEFAULT_GROUP_LABELS: Record<string, string> = {
  events: "Events",
  images: "Images",
  media: "Media",
  documents: "Documents",
};

export type ToolShellState = {
  version: 1;
  groups: string[]; // ordered group ids, excludes FAV (which is implicit-first)
  groupLabels: Record<string, string>;
  membership: Record<string, string[]>; // toolId -> group ids (override; absent = use defaultGroups)
  favourites: string[]; // tool ids
};

export function seedState(): ToolShellState {
  return {
    version: 1,
    groups: [...DEFAULT_GROUP_ORDER],
    groupLabels: { ...DEFAULT_GROUP_LABELS },
    membership: {},
    favourites: [],
  };
}

export function effectiveGroups(state: ToolShellState, tool: Tool): string[] {
  const raw = state.membership[tool.id] ?? tool.defaultGroups;
  return raw.filter((g) => state.groups.includes(g));
}

export function toolsInGroup(state: ToolShellState, tools: Tool[], groupId: string): Tool[] {
  return tools.filter((t) => effectiveGroups(state, t).includes(groupId));
}

export function visibleTools(
  state: ToolShellState,
  tools: Tool[],
  activeGroup: string,
  query: string,
): Tool[] {
  if (query.trim()) return searchTools(tools, query);
  if (activeGroup === FAV) return tools.filter((t) => state.favourites.includes(t.id));
  return toolsInGroup(state, tools, activeGroup);
}

export const TOOL_SHELL_KEY = "ee.toolShell";
export const TOOL_SHELL_EVENT = "ee:tool-shell-change";

export function parseToolShell(raw: string | null): ToolShellState {
  if (!raw) return seedState();
  try {
    const p = JSON.parse(raw);
    if (
      !p ||
      p.version !== 1 ||
      !Array.isArray(p.groups) ||
      typeof p.groupLabels !== "object" ||
      typeof p.membership !== "object" ||
      !Array.isArray(p.favourites)
    ) {
      return seedState();
    }
    return {
      version: 1,
      groups: p.groups.filter((g: unknown): g is string => typeof g === "string"),
      groupLabels: p.groupLabels,
      membership: p.membership,
      favourites: p.favourites.filter((f: unknown): f is string => typeof f === "string"),
    };
  } catch {
    return seedState();
  }
}

export function readToolShell(): ToolShellState {
  if (typeof window === "undefined") return seedState();
  return parseToolShell(window.localStorage.getItem(TOOL_SHELL_KEY));
}

export function writeToolShell(state: ToolShellState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOOL_SHELL_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(TOOL_SHELL_EVENT));
}
```

Note: `TOOLS` is imported so future selectors can default to the full registry; it is intentionally re-exportable but unused here beyond keeping the import path warm. If your linter flags the unused import, drop `TOOLS` from the import and keep `searchTools`, `type Tool`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/event-editor/packages/web && npx vitest run test/tool-store.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
cd ~/event-editor
git add packages/web/components/tool-store.ts packages/web/test/tool-store.test.ts
git commit -m "feat(web): tool-shell state, seed, selectors, persistence"
```

---

## Task 3: Store reducers — favourite, membership, group CRUD

**Files:**
- Modify: `packages/web/components/tool-store.ts`
- Test: `packages/web/test/tool-store-reducers.test.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces (all pure, return a new `ToolShellState`; none mutate their input):
  - `function toggleFavourite(state, toolId: string): ToolShellState`
  - `function setMembership(state, tool: Tool, groupId: string, on: boolean): ToolShellState`
  - `function slugify(label: string): string`
  - `function createGroup(state, label: string, addToolId?: string): { state: ToolShellState; id: string }`
  - `function renameGroup(state, groupId: string, label: string): ToolShellState`
  - `function deleteGroup(state, groupId: string): ToolShellState`
  - `function reorderGroups(state, orderedIds: string[]): ToolShellState`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/tool-store-reducers.test.ts
import { describe, it, expect } from "vitest";
import { toolById } from "@/components/tools";
import {
  seedState,
  effectiveGroups,
  toggleFavourite,
  setMembership,
  slugify,
  createGroup,
  renameGroup,
  deleteGroup,
  reorderGroups,
} from "@/components/tool-store";

const sorter = toolById("sorter")!;

describe("toggleFavourite", () => {
  it("adds then removes a favourite without mutating input", () => {
    const s0 = seedState();
    const s1 = toggleFavourite(s0, "slice");
    expect(s1.favourites).toEqual(["slice"]);
    expect(s0.favourites).toEqual([]); // input untouched
    expect(toggleFavourite(s1, "slice").favourites).toEqual([]);
  });
});

describe("setMembership", () => {
  it("materialises the override from defaultGroups on first edit", () => {
    const s = setMembership(seedState(), sorter, "media", true);
    expect(s.membership.sorter.sort()).toEqual(["events", "images", "media"].sort());
  });
  it("removes a group and keeps the rest", () => {
    const s = setMembership(seedState(), sorter, "events", false);
    expect(s.membership.sorter).toEqual(["images"]);
  });
  it("is idempotent when adding an existing group", () => {
    const s = setMembership(seedState(), sorter, "images", true);
    expect(effectiveGroups(s, sorter).sort()).toEqual(["events", "images"].sort());
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("  Client Weddings! ")).toBe("client-weddings");
  });
  it("falls back to 'group' for empty input", () => {
    expect(slugify("!!!")).toBe("group");
  });
});

describe("createGroup", () => {
  it("appends a slugged group with its label and returns the id", () => {
    const { state, id } = createGroup(seedState(), "Weddings");
    expect(id).toBe("weddings");
    expect(state.groups).toContain("weddings");
    expect(state.groupLabels.weddings).toBe("Weddings");
  });
  it("dedupes a colliding slug with a numeric suffix", () => {
    const first = createGroup(seedState(), "Events"); // collides with seed "events"
    expect(first.id).toBe("events-2");
  });
  it("adds the tool to the new group when addToolId is given", () => {
    const { state, id } = createGroup(seedState(), "Weddings", "slice");
    expect(state.membership.slice).toContain(id);
  });
});

describe("renameGroup", () => {
  it("changes the label only, not the id or order", () => {
    const s = renameGroup(seedState(), "images", "Pictures");
    expect(s.groups).toContain("images");
    expect(s.groupLabels.images).toBe("Pictures");
  });
});

describe("deleteGroup", () => {
  it("removes the group and strips it from every membership override", () => {
    const withOverride = setMembership(seedState(), sorter, "media", true);
    const s = deleteGroup(withOverride, "media");
    expect(s.groups).not.toContain("media");
    expect(s.groupLabels.media).toBeUndefined();
    expect(s.membership.sorter).not.toContain("media");
  });
});

describe("reorderGroups", () => {
  it("applies a new order, keeping only known ids", () => {
    const s = reorderGroups(seedState(), ["documents", "images", "nope", "events", "media"]);
    expect(s.groups).toEqual(["documents", "images", "events", "media"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/event-editor/packages/web && npx vitest run test/tool-store-reducers.test.ts`
Expected: FAIL — `toggleFavourite` etc. are not exported.

- [ ] **Step 3: Write minimal implementation** (append to `components/tool-store.ts`)

```ts
// --- reducers (append to components/tool-store.ts) ---

export function toggleFavourite(state: ToolShellState, toolId: string): ToolShellState {
  const has = state.favourites.includes(toolId);
  return {
    ...state,
    favourites: has ? state.favourites.filter((f) => f !== toolId) : [...state.favourites, toolId],
  };
}

export function setMembership(
  state: ToolShellState,
  tool: Tool,
  groupId: string,
  on: boolean,
): ToolShellState {
  const current = state.membership[tool.id] ?? tool.defaultGroups;
  const next = on
    ? current.includes(groupId)
      ? current
      : [...current, groupId]
    : current.filter((g) => g !== groupId);
  return { ...state, membership: { ...state.membership, [tool.id]: next } };
}

export function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "group";
}

export function createGroup(
  state: ToolShellState,
  label: string,
  addToolId?: string,
): { state: ToolShellState; id: string } {
  const base = slugify(label);
  let id = base;
  let n = 2;
  const taken = new Set([FAV, ...state.groups]);
  while (taken.has(id)) id = `${base}-${n++}`;
  const groups = [...state.groups, id];
  const groupLabels = { ...state.groupLabels, [id]: label.trim() || id };
  let membership = state.membership;
  if (addToolId) {
    const tool = TOOLS.find((t) => t.id === addToolId);
    const current = membership[addToolId] ?? tool?.defaultGroups ?? [];
    membership = { ...membership, [addToolId]: [...current, id] };
  }
  return { state: { ...state, groups, groupLabels, membership }, id };
}

export function renameGroup(state: ToolShellState, groupId: string, label: string): ToolShellState {
  if (!state.groups.includes(groupId)) return state;
  return { ...state, groupLabels: { ...state.groupLabels, [groupId]: label.trim() || groupId } };
}

export function deleteGroup(state: ToolShellState, groupId: string): ToolShellState {
  const groups = state.groups.filter((g) => g !== groupId);
  const groupLabels = { ...state.groupLabels };
  delete groupLabels[groupId];
  const membership: Record<string, string[]> = {};
  for (const [toolId, gs] of Object.entries(state.membership)) {
    membership[toolId] = gs.filter((g) => g !== groupId);
  }
  return { ...state, groups, groupLabels, membership };
}

export function reorderGroups(state: ToolShellState, orderedIds: string[]): ToolShellState {
  const known = orderedIds.filter((g) => state.groups.includes(g));
  const missing = state.groups.filter((g) => !known.includes(g));
  return { ...state, groups: [...known, ...missing] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/event-editor/packages/web && npx vitest run test/tool-store-reducers.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
cd ~/event-editor
git add packages/web/components/tool-store.ts packages/web/test/tool-store-reducers.test.ts
git commit -m "feat(web): tool-shell reducers for favourites and group CRUD"
```

---

## Task 4: Search-visibility helper

**Files:**
- Modify: `packages/web/components/tool-store.ts`
- Test: `packages/web/test/search-visibility.test.ts`

**Interfaces:**
- Produces: `function nextSearchVisibility(prevY: number, curY: number, threshold: number): boolean` — pure scroll-direction rule for the reveal-on-scroll search bar. Near the top (`curY <= threshold`) it is always visible; scrolling down hides it; scrolling up reveals it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/search-visibility.test.ts
import { describe, it, expect } from "vitest";
import { nextSearchVisibility } from "@/components/tool-store";

describe("nextSearchVisibility", () => {
  it("is visible at or above the threshold regardless of direction", () => {
    expect(nextSearchVisibility(500, 4, 8)).toBe(true);
    expect(nextSearchVisibility(0, 8, 8)).toBe(true);
  });
  it("hides when scrolling down past the threshold", () => {
    expect(nextSearchVisibility(100, 160, 8)).toBe(false);
  });
  it("reveals when scrolling up past the threshold", () => {
    expect(nextSearchVisibility(400, 320, 8)).toBe(true);
  });
  it("holds visible when there is no vertical movement", () => {
    expect(nextSearchVisibility(300, 300, 8)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/event-editor/packages/web && npx vitest run test/search-visibility.test.ts`
Expected: FAIL — `nextSearchVisibility` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `components/tool-store.ts`)

```ts
// --- search bar reveal-on-scroll (append to components/tool-store.ts) ---

export function nextSearchVisibility(prevY: number, curY: number, threshold: number): boolean {
  if (curY <= threshold) return true; // near the top: always show
  if (curY > prevY) return false; // scrolling down: hide
  return true; // scrolling up or unchanged: show
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/event-editor/packages/web && npx vitest run test/search-visibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/event-editor
git add packages/web/components/tool-store.ts packages/web/test/search-visibility.test.ts
git commit -m "feat(web): pure reveal-on-scroll visibility rule for search bar"
```

---

## Task 5: Shell context provider

**Files:**
- Create: `packages/web/components/tool-shell-context.tsx`

**Interfaces:**
- Consumes: `ToolShellState`, `FAV`, `readToolShell`, `writeToolShell`, `TOOL_SHELL_EVENT`, and all reducers from `@/components/tool-store`; `Tool` from `@/components/tools`.
- Produces:
  - `function ToolShellProvider({ children }: { children: ReactNode }): JSX.Element`
  - `function useToolShell(): { state: ToolShellState; activeGroup: string; setActiveGroup(id: string): void; query: string; setQuery(q: string): void; toggleFavourite(id: string): void; setMembership(tool: Tool, groupId: string, on: boolean): void; createGroup(label: string, addToolId?: string): string; renameGroup(id: string, label: string): void; deleteGroup(id: string): void; reorderGroups(ids: string[]): void }`

This task has no unit test (the codebase has no React test environment). It is verified by the tasks that consume it and by a manual build check. Keep it a thin delegator to the tested pure reducers.

- [ ] **Step 1: Write the provider and hook**

```tsx
// packages/web/components/tool-shell-context.tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Tool } from "@/components/tools";
import {
  FAV,
  TOOL_SHELL_EVENT,
  readToolShell,
  writeToolShell,
  toggleFavourite as rToggleFavourite,
  setMembership as rSetMembership,
  createGroup as rCreateGroup,
  renameGroup as rRenameGroup,
  deleteGroup as rDeleteGroup,
  reorderGroups as rReorderGroups,
  seedState,
  type ToolShellState,
} from "@/components/tool-store";

type ShellCtx = {
  state: ToolShellState;
  activeGroup: string;
  setActiveGroup: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  toggleFavourite: (id: string) => void;
  setMembership: (tool: Tool, groupId: string, on: boolean) => void;
  createGroup: (label: string, addToolId?: string) => string;
  renameGroup: (id: string, label: string) => void;
  deleteGroup: (id: string) => void;
  reorderGroups: (ids: string[]) => void;
};

const Ctx = createContext<ShellCtx | null>(null);

export function ToolShellProvider({ children }: { children: ReactNode }) {
  // Seed on the server and first client render to avoid hydration mismatch, then hydrate from storage.
  const [state, setState] = useState<ToolShellState>(seedState);
  const [activeGroup, setActiveGroup] = useState<string>(FAV);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setState(readToolShell());
    const onChange = () => setState(readToolShell());
    window.addEventListener(TOOL_SHELL_EVENT, onChange);
    return () => window.removeEventListener(TOOL_SHELL_EVENT, onChange);
  }, []);

  // Persist + broadcast, then reflect locally.
  const commit = useCallback((next: ToolShellState) => {
    writeToolShell(next);
    setState(next);
  }, []);

  const value: ShellCtx = {
    state,
    activeGroup,
    setActiveGroup,
    query,
    setQuery,
    toggleFavourite: (id) => commit(rToggleFavourite(state, id)),
    setMembership: (tool, groupId, on) => commit(rSetMembership(state, tool, groupId, on)),
    createGroup: (label, addToolId) => {
      const { state: next, id } = rCreateGroup(state, label, addToolId);
      commit(next);
      return id;
    },
    renameGroup: (id, label) => commit(rRenameGroup(state, id, label)),
    deleteGroup: (id) => {
      if (activeGroup === id) setActiveGroup(FAV);
      commit(rDeleteGroup(state, id));
    },
    reorderGroups: (ids) => commit(rReorderGroups(state, ids)),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToolShell(): ShellCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToolShell must be used within ToolShellProvider");
  return ctx;
}
```

- [ ] **Step 2: Type-check the new file compiles**

Run: `cd ~/event-editor/packages/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `tool-shell-context.tsx`.

- [ ] **Step 3: Commit**

```bash
cd ~/event-editor
git add packages/web/components/tool-shell-context.tsx
git commit -m "feat(web): tool-shell React context over pure store"
```

---

## Task 6: Grouped topbar

**Files:**
- Modify: `packages/web/components/Nav.tsx` (full rewrite)

**Interfaces:**
- Consumes: `useToolShell` from `@/components/tool-shell-context`; `FAV` from `@/components/tool-store`; `navShouldAnimate`, `bestMatchIndex` are no longer used by Nav (index now comes from `activeGroup`, not the path).

The topbar renders `[Favourites, ...state.groups]` as pills with the existing sliding thumb, a Home wordmark on the left, and a Settings gear on the right. Clicking a pill sets `activeGroup`; if not already on `/`, it also navigates there so the filtered grid is visible.

- [ ] **Step 1: Rewrite `Nav.tsx`**

```tsx
// packages/web/components/Nav.tsx
"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Home, Settings } from "lucide-react";
import { useToolShell } from "@/components/tool-shell-context";
import { FAV } from "@/components/tool-store";

export function Nav() {
  const router = useRouter();
  const path = usePathname();
  const { state, activeGroup, setActiveGroup } = useToolShell();

  const pills = [
    { id: FAV, label: "Favourites" },
    ...state.groups.map((id) => ({ id, label: state.groupLabels[id] ?? id })),
  ];
  const activeIdx = Math.max(0, pills.findIndex((p) => p.id === activeGroup));

  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const enabled = useRef(false);
  const [motionOK, setMotionOK] = useState(false);

  useEffect(() => {
    setMotionOK(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useLayoutEffect(() => {
    const el = pillRefs.current[activeIdx];
    const thumb = thumbRef.current;
    if (!el || !thumb) return;
    const willAnimate = motionOK && enabled.current;
    if (!willAnimate) thumb.style.transition = "none";
    thumb.style.transform = `translateX(${el.offsetLeft}px)`;
    thumb.style.width = `${el.offsetWidth}px`;
    thumb.style.top = `${el.offsetTop}px`;
    thumb.style.height = `${el.offsetHeight}px`;
    if (!willAnimate) {
      requestAnimationFrame(() => {
        if (thumbRef.current) thumbRef.current.style.transition = "";
        enabled.current = true;
      });
    }
  }, [activeIdx, motionOK, pills.length]);

  function pick(id: string) {
    setActiveGroup(id);
    if (path !== "/") router.push("/");
  }

  return (
    <header className="relative border-b border-line">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3">
        <Link href="/" aria-label="Home" className="flex shrink-0 items-center gap-2 text-sm font-semibold text-ink">
          <Home size={18} strokeWidth={1.75} aria-hidden />
          <span className="hidden sm:inline">Event Editor</span>
        </Link>

        <nav className="relative flex flex-1 items-center gap-1 overflow-x-auto">
          <span ref={thumbRef} aria-hidden className="nav-thumb pointer-events-none absolute left-0 top-0 z-0 rounded-lg bg-ink" />
          {pills.map((p, i) => {
            const active = i === activeIdx;
            return (
              <button
                key={p.id}
                type="button"
                ref={(el) => {
                  pillRefs.current[i] = el;
                }}
                onClick={() => pick(p.id)}
                aria-pressed={active}
                className={`relative z-10 inline-flex items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                  active ? "text-white" : "text-muted hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </nav>

        <Link
          href="/settings"
          aria-label="Settings"
          aria-current={path.startsWith("/settings") ? "page" : undefined}
          className="flex shrink-0 items-center rounded-lg px-2 py-2 text-muted hover:text-ink"
        >
          <Settings size={18} strokeWidth={1.75} aria-hidden />
        </Link>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd ~/event-editor/packages/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `Nav.tsx`. (`app/layout.tsx` still wraps `<Nav/>` outside the provider — Task 10 wires the provider; until then the app will throw at runtime, which is expected between tasks. Do not run the dev server to verify yet.)

- [ ] **Step 3: Commit**

```bash
cd ~/event-editor
git add packages/web/components/Nav.tsx
git commit -m "feat(web): grouped topbar with favourites pinned first"
```

---

## Task 7: Card tags + menu button, and CardMenu popover

**Files:**
- Modify: `packages/web/components/tool-illustrations.tsx` (add `getIllustration`)
- Modify: `packages/web/components/ToolCard.tsx` (tags row + menu button)
- Create: `packages/web/components/CardMenu.tsx`

**Interfaces:**
- `getIllustration(id: string): ReactNode` — returns the existing illustration for a tool id, or `null`.
- `ToolCard` new props: `{ tool: Tool }` (replaces the old `href/title/body/illustration/Icon` prop list). It renders the illustration via `getIllustration(tool.id)`, the tag row, and mounts `<CardMenu tool={tool}/>`.
- `CardMenu({ tool }: { tool: Tool })` — a popover button reading/writing `useToolShell`.

- [ ] **Step 1: Add `getIllustration` to `tool-illustrations.tsx`**

At the bottom of `components/tool-illustrations.tsx`, after the existing named illustration exports, add:

```tsx
import type { ReactNode } from "react";

const ILLUSTRATIONS: Record<string, ReactNode> = {
  sorter: <SorterIllus />,
  studio: <StudioIllus />,
  transcribe: <TranscribeIllus />,
  slice: <SliceIllus />,
  convert: <ConvertIllus />,
};

export function getIllustration(id: string): ReactNode {
  return ILLUSTRATIONS[id] ?? null;
}
```

(If `tool-illustrations.tsx` already imports `ReactNode`, do not duplicate the import.)

- [ ] **Step 2: Write `CardMenu.tsx`**

```tsx
// packages/web/components/CardMenu.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Star } from "lucide-react";
import type { Tool } from "@/components/tools";
import { useToolShell } from "@/components/tool-shell-context";
import { effectiveGroups } from "@/components/tool-store";

export function CardMenu({ tool }: { tool: Tool }) {
  const shell = useToolShell();
  const [open, setOpen] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isFav = shell.state.favourites.includes(tool.id);
  const inGroups = new Set(effectiveGroups(shell.state, tool));

  function addGroup() {
    const label = newGroup.trim();
    if (!label) return;
    shell.createGroup(label, tool.id);
    setNewGroup("");
  }

  return (
    <div ref={ref} className="absolute right-2 top-2 z-20">
      <button
        type="button"
        aria-label="Card options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-lg border border-line bg-surface p-1.5 text-muted shadow-soft hover:text-ink"
      >
        <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          onClick={(e) => e.preventDefault()}
          className="absolute right-0 mt-1 w-56 rounded-xl border border-line bg-surface p-2 text-sm shadow-soft"
        >
          <button
            type="button"
            onClick={() => shell.toggleFavourite(tool.id)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-ink hover:bg-[#eef0f3]"
          >
            <Star size={16} strokeWidth={1.75} className={isFav ? "fill-current text-ink" : "text-muted"} aria-hidden />
            {isFav ? "Remove from favourites" : "Add to favourites"}
          </button>

          <div className="my-1 h-px bg-line" />

          <div className="max-h-48 overflow-y-auto">
            {shell.state.groups.map((gid) => (
              <label key={gid} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#eef0f3]">
                <input
                  type="checkbox"
                  checked={inGroups.has(gid)}
                  onChange={(e) => shell.setMembership(tool, gid, e.target.checked)}
                />
                <span className="text-ink">{shell.state.groupLabels[gid] ?? gid}</span>
              </label>
            ))}
          </div>

          <div className="my-1 h-px bg-line" />

          <div className="flex items-center gap-1 px-1">
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addGroup();
              }}
              placeholder="New group"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm outline-none"
            />
            <button type="button" onClick={addGroup} className="rounded-lg border border-line px-2 py-1 text-muted hover:text-ink">
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `ToolCard.tsx`**

```tsx
// packages/web/components/ToolCard.tsx
import Link from "next/link";
import type { Tool } from "@/components/tools";
import { getIllustration } from "@/components/tool-illustrations";
import { CardMenu } from "@/components/CardMenu";

export function ToolCard({ tool }: { tool: Tool }) {
  const { Icon } = tool;
  return (
    <div className="group relative h-full rounded-[20px] border border-line bg-surface p-4 shadow-soft transition-colors hover:border-muted/40">
      <CardMenu tool={tool} />
      <Link href={tool.href} className="block">
        <div className="relative h-48 overflow-hidden rounded-2xl bg-[#eef0f3] p-4">{getIllustration(tool.id)}</div>
        <h2 className="mt-4 flex items-center gap-2 text-base font-semibold">
          <Icon size={18} strokeWidth={1.75} className="text-ink" aria-hidden />
          {tool.title}
        </h2>
        <p className="mt-1.5 text-[13px] text-muted">{tool.body}</p>
      </Link>
      <div className="mt-2 flex flex-wrap gap-1">
        {tool.tags.slice(0, 4).map((t) => (
          <span key={t} className="rounded-md bg-[#eef0f3] px-1.5 py-0.5 text-[11px] text-muted">
            {t}
          </span>
        ))}
        {tool.tags.length > 4 && <span className="px-1 py-0.5 text-[11px] text-muted">+{tool.tags.length - 4}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd ~/event-editor/packages/web && npx tsc --noEmit -p tsconfig.json`
Expected: `ToolCard.tsx`, `CardMenu.tsx`, `tool-illustrations.tsx` compile. `app/page.tsx` will error because it still uses the old `ToolCard` prop shape — Task 8 rewrites it. That error is expected now.

- [ ] **Step 5: Commit**

```bash
cd ~/event-editor
git add packages/web/components/ToolCard.tsx packages/web/components/CardMenu.tsx packages/web/components/tool-illustrations.tsx
git commit -m "feat(web): card tags row and favourite/group popover menu"
```

---

## Task 8: Home grid + reveal-on-scroll search

**Files:**
- Create: `packages/web/components/ToolGrid.tsx`
- Create: `packages/web/components/ToolSearch.tsx`
- Modify: `packages/web/app/page.tsx` (thin wrapper)

**Interfaces:**
- Consumes: `useToolShell`; `TOOLS`, `visibleTools`, `nextSearchVisibility` from the store; `ToolCard`.
- `ToolGrid()` renders `visibleTools(state, TOOLS, activeGroup, query)` and empty states.
- `ToolSearch()` renders the search input, drives `query`, and self-hides on scroll-down.

- [ ] **Step 1: Write `ToolGrid.tsx`**

```tsx
// packages/web/components/ToolGrid.tsx
"use client";
import { TOOLS } from "@/components/tools";
import { visibleTools } from "@/components/tool-store";
import { useToolShell } from "@/components/tool-shell-context";
import { ToolCard } from "@/components/ToolCard";

export function ToolGrid() {
  const { state, activeGroup, query } = useToolShell();
  const tools = visibleTools(state, TOOLS, activeGroup, query);

  if (tools.length === 0) {
    const msg = query.trim()
      ? `No tools match "${query.trim()}"`
      : "No tools in this group yet";
    return <p className="py-16 text-center text-sm text-muted">{msg}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write `ToolSearch.tsx`**

```tsx
// packages/web/components/ToolSearch.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useToolShell } from "@/components/tool-shell-context";
import { nextSearchVisibility } from "@/components/tool-store";

export function ToolSearch() {
  const { query, setQuery } = useToolShell();
  const [visible, setVisible] = useState(true);
  const [motionOK, setMotionOK] = useState(true);
  const lastY = useRef(0);

  useEffect(() => {
    setMotionOK(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    function onScroll() {
      const y = window.scrollY;
      setVisible(nextSearchVisibility(lastY.current, y, 8));
      lastY.current = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur ${
        motionOK ? "transition-transform duration-200" : ""
      }`}
      style={{ transform: visible ? "translateY(0)" : "translateY(-100%)" }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-2">
        <Search size={16} strokeWidth={1.75} className="text-muted" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools by name or tag"
          aria-label="Search tools"
          className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted"
        />
      </div>
    </div>
  );
}
```

Note on colours: `bg-canvas` and `border-line` are the existing theme tokens used elsewhere in the app. If `bg-canvas` is not defined in the Tailwind theme, use the same background token `app/layout.tsx`'s `<body>` resolves to (check `globals.css`); the intent is "same as the page background".

- [ ] **Step 3: Rewrite `app/page.tsx`**

```tsx
// packages/web/app/page.tsx
import { ToolGrid } from "@/components/ToolGrid";

export default function Home() {
  return <ToolGrid />;
}
```

- [ ] **Step 4: Type-check**

Run: `cd ~/event-editor/packages/web && npx tsc --noEmit -p tsconfig.json`
Expected: these three files compile. (`layout.tsx` still lacks the provider — fixed in Task 10.)

- [ ] **Step 5: Commit**

```bash
cd ~/event-editor
git add packages/web/components/ToolGrid.tsx packages/web/components/ToolSearch.tsx packages/web/app/page.tsx
git commit -m "feat(web): filtered home grid and reveal-on-scroll search"
```

---

## Task 9: Settings group manager

**Files:**
- Create: `packages/web/components/GroupManager.tsx`
- Modify: `packages/web/app/settings/page.tsx` (swap `NavOrder` for `GroupManager`)

**Interfaces:**
- Consumes: `useToolShell`; `FAV` from the store.
- `GroupManager()` lists Favourites (pinned, read-only) then each group with drag-reorder, inline rename, and delete; plus a create field. All actions call the tested reducers via context.

- [ ] **Step 1: Write `GroupManager.tsx`** (reuses the pointer-drag pattern from the old `NavOrder.tsx`)

```tsx
// packages/web/components/GroupManager.tsx
"use client";
import { useRef, useState } from "react";
import { GripVertical, Star, Trash2 } from "lucide-react";
import { useToolShell } from "@/components/tool-shell-context";

export function GroupManager() {
  const shell = useToolShell();
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const rowRef = useRef<HTMLDivElement | null>(null);

  const ids = order ?? shell.state.groups;

  function onPointerDown(e: React.PointerEvent, i: number) {
    e.preventDefault();
    setOrder(shell.state.groups.slice());
    setDragIdx(i);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (dragIdx === null || !rowRef.current) return;
    const rows = Array.from(rowRef.current.querySelectorAll<HTMLElement>("[data-row]"));
    const y = e.clientY;
    let target = dragIdx;
    rows.forEach((p, j) => {
      const r = p.getBoundingClientRect();
      if (y > r.top + r.height / 2) target = Math.max(target, j);
      if (y < r.top + r.height / 2 && j <= dragIdx) target = Math.min(target, j);
    });
    if (target !== dragIdx) {
      setOrder((prev) => {
        const next = (prev ?? shell.state.groups).slice();
        const [m] = next.splice(dragIdx, 1);
        next.splice(target, 0, m);
        return next;
      });
      setDragIdx(target);
    }
  }
  function onPointerUp() {
    if (order) shell.reorderGroups(order);
    setOrder(null);
    setDragIdx(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted shadow-soft">
        <Star size={16} strokeWidth={1.75} className="fill-current text-ink" aria-hidden />
        Favourites
        <span className="ml-auto text-xs">pinned</span>
      </div>

      <div ref={rowRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="space-y-2">
        {ids.map((gid, i) => (
          <div
            key={gid}
            data-row
            className={`flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-soft ${
              dragIdx === i ? "opacity-70" : ""
            }`}
          >
            <button
              type="button"
              aria-label="Drag to reorder"
              onPointerDown={(e) => onPointerDown(e, i)}
              className="cursor-grab text-muted"
            >
              <GripVertical size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <input
              value={shell.state.groupLabels[gid] ?? gid}
              onChange={(e) => shell.renameGroup(gid, e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-ink outline-none"
              aria-label={`Rename ${shell.state.groupLabels[gid] ?? gid}`}
            />
            <button
              type="button"
              aria-label={`Delete ${shell.state.groupLabels[gid] ?? gid}`}
              onClick={() => shell.deleteGroup(gid)}
              className="text-muted hover:text-ink"
            >
              <Trash2 size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newGroup.trim()) {
              shell.createGroup(newGroup.trim());
              setNewGroup("");
            }
          }}
          placeholder="New group name"
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => {
            if (newGroup.trim()) {
              shell.createGroup(newGroup.trim());
              setNewGroup("");
            }
          }}
          className="rounded-xl border border-line px-3 py-2 text-sm text-muted hover:text-ink"
        >
          Add group
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Swap the component in Settings**

In `packages/web/app/settings/page.tsx`: replace the `import { NavOrder } from "./NavOrder";` line with `import { GroupManager } from "@/components/GroupManager";`, and replace the `<NavOrder />` usage with `<GroupManager />`. Update the section's heading/description copy from reordering tools to "Groups — reorder, rename, or remove the groups your tools are organised into." (Sentence case, no em dashes.)

- [ ] **Step 3: Type-check**

Run: `cd ~/event-editor/packages/web && npx tsc --noEmit -p tsconfig.json`
Expected: `GroupManager.tsx` and `settings/page.tsx` compile.

- [ ] **Step 4: Commit**

```bash
cd ~/event-editor
git add packages/web/components/GroupManager.tsx packages/web/app/settings/page.tsx
git commit -m "feat(web): settings group manager replaces nav reorder"
```

---

## Task 10: Wire the provider, mount search, remove dead code, verify end to end

**Files:**
- Modify: `packages/web/app/layout.tsx`
- Delete: `packages/web/components/nav-links.ts`, `packages/web/test/nav-links.test.ts`, `packages/web/app/settings/NavOrder.tsx`

**Interfaces:**
- Consumes: `ToolShellProvider`, `ToolSearch`, `Nav`.

- [ ] **Step 1: Rewrite `app/layout.tsx`**

```tsx
// packages/web/app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { ToolSearch } from "@/components/ToolSearch";
import { ToolShellProvider } from "@/components/tool-shell-context";

export const metadata = { title: "event-editor", description: "Media and event tools" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToolShellProvider>
          <Nav />
          <ToolSearch />
          <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
        </ToolShellProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Confirm nothing else imports the files being deleted**

Run: `cd ~/event-editor/packages/web && grep -rn "nav-links\|NavOrder" app components test --include="*.ts" --include="*.tsx"`
Expected: only references are the definitions themselves (`components/nav-links.ts`, `test/nav-links.test.ts`, `app/settings/NavOrder.tsx`). If any live component still imports them, fix that import first (Nav and settings/page were updated in Tasks 6 and 9).

- [ ] **Step 3: Delete the superseded files**

```bash
cd ~/event-editor/packages/web
git rm components/nav-links.ts test/nav-links.test.ts app/settings/NavOrder.tsx
```

- [ ] **Step 4: Full type-check and test run**

Run: `cd ~/event-editor/packages/web && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: type-check clean; all vitest suites pass (including the four new suites: `tools`, `tool-store`, `tool-store-reducers`, `search-visibility`; `nav-anim` still green; `nav-links` suite gone).

- [ ] **Step 5: Manual verification against the running app**

Start the dev server (`cd ~/event-editor && npm run dev`) and open `http://localhost:3000`. Confirm:
  1. Topbar shows `Favourites | Events | Images | Media | Documents` with the sliding thumb; Favourites selected on load; grid is empty with "No tools in this group yet".
  2. Open a card's "⋯" menu, add to favourites — the card appears under Favourites. Tick/untick groups — the card shows/hides under those group filters.
  3. "+ New group" in a card menu creates a group, adds the card, and the new pill appears in the topbar.
  4. Type in the search bar — grid filters across all tools by tag/name/body; the active pill dims; clearing restores the group view.
  5. Scroll the page down — the search bar tucks up under the topbar; scroll up — it returns. With OS "reduce motion" on, it snaps instead of sliding.
  6. Settings → group manager: drag to reorder (Favourites stays pinned above), rename inline, delete a group (cards fall back / lose that membership), add a group.
  7. Reload the page — favourites, memberships, groups, and order all persist.

- [ ] **Step 6: Commit**

```bash
cd ~/event-editor
git add -A
git commit -m "feat(web): mount tool-shell provider and search, drop nav-order code"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- Grouped topbar, Favourites pinned + default view → Tasks 5 (state), 6 (Nav). ✓
- Filter-in-place on group click → Task 6 `pick()` + Task 8 `ToolGrid`/`visibleTools`. ✓
- User-creatable/renamable/deletable groups, multi-membership → Task 3 reducers, Task 7 CardMenu, Task 9 GroupManager. ✓
- Author tags on cards → Task 1 (data) + Task 7 (tag row). ✓
- Search matches tags + title + description → Task 1 `searchTools`. ✓
- Reveal-on-scroll-up search → Task 4 `nextSearchVisibility` + Task 8 `ToolSearch`. ✓
- `localStorage` persistence, seed on first run, membership fallback → Task 2. ✓
- Registry holds all 13 (new tools register themselves) → Task 1 shape; membership-fallback means new tools appear via `defaultGroups` with no store migration. ✓
- Empty states (empty group, no search results) → Task 8. ✓
- Settings group management reuses drag UI → Task 9. ✓
- Open items from the spec are resolved: Home = wordmark link, Settings = pinned gear (Task 6); default groups are deletable (uniform model, Task 3 `deleteGroup`); active-group + query live in the context, persisted state in the store (Task 5). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows assertions. ✓

**Type consistency:** `ToolShellState`, `FAV`, `effectiveGroups`, `visibleTools`, `setMembership(state, tool, groupId, on)`, `createGroup(state, label, addToolId?) → {state, id}` are used with identical signatures in the context (Task 5), CardMenu (Task 7), and GroupManager (Task 9). `ToolCard` takes `{ tool }` in Task 7 and is called as `<ToolCard tool={t}/>` in Task 8. `getIllustration(id)` defined in Task 7, used in the same task. ✓
