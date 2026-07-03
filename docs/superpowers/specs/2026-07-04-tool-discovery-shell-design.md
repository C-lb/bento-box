# Tool discovery shell: groups, favourites, tags, search

Date: 2026-07-04
Package: `packages/web`
Status: approved, ready to plan

## Problem

The app is adding ~8 new tools (13 total). The current shell does not scale to
that many:

- The topbar is a flat row of every tool with a sliding-thumb highlight. At 13
  tools it overflows and stops being a usable index.
- Home is a hardcoded array of `ToolCard`s in a single flat grid. No way to
  group, favourite, or find a tool by what it does.
- There is no organising layer between "all tools" and "the one I want".

This spec is the **shell only**. It ships against the existing 5 tools but is
built so the 8 new tools (separate specs) register themselves and appear with no
further shell work.

## Goals

1. Topbar becomes a row of **groups**, not individual tools, with the existing
   sliding-thumb highlight. Favourites is pinned leftmost and is the default
   view on load.
2. Clicking a group **filters the Home grid in place** to that group's cards.
3. Every card shows **tags** and a **popover** to favourite it and to
   add/remove it from any group (multi-membership), including creating a new
   group inline.
4. Groups are **user-creatable, renamable, deletable, reorderable** (Favourites
   pinned, undeletable). Seeded with sensible defaults.
5. A **search field** under the topbar that hides on scroll-down and reveals on
   scroll-up, filtering the grid live against tags + title + description.
6. A single **tool registry** so tools (current and future) are declared in one
   place with their default groups and tags.

Non-goals:
- No new tool functionality. The 8 new converters are separate specs (Spec B
  batches). This spec only makes the shell able to hold them.
- No server/DB persistence for user state. `localStorage` only, matching the
  existing `ee.navOrder` pattern (single-user desktop app).
- No drag-reorder of groups on the live topbar; reorder + group management lives
  in Settings, reusing the existing drag UI.
- Tags are author-defined per tool, not user-editable.

## Design

### 1. Tool registry (`components/tools.ts`, extends `nav-links.ts`)

Single source of truth for every tool. Replaces the `TOOLS` array currently
inlined in `app/page.tsx` and supersedes `TOOL_LINKS` in `nav-links.ts`.

```ts
export type Tool = {
  id: string;              // stable key, e.g. "sorter"
  href: string;            // "/sorter"
  title: string;
  body: string;            // shown on card; also searched
  Icon: LucideIcon;
  illustration: ReactNode; // existing per-tool illustration
  defaultGroups: string[]; // seed membership, group ids
  tags: string[];          // author-defined, lowercase, searched
};

export const TOOLS: Tool[] = [ /* 5 today, 13 after Spec B */ ];
```

Seed group assignments + tags for the current 5:

| Tool | id | defaultGroups | tags (sample) |
|------|----|--------------| --------------|
| Photo sorter | `sorter` | Images, Events | rank, drive, headshot, photo, image |
| Headshot studio | `studio` | Images, Events | headshot, brand, portrait, image |
| Audio transcriber | `transcribe` | Media, Events | transcribe, audio, speech, doc, subtitle |
| Slide slicer | `slice` | Documents | pdf, deck, slides, split, stamp |
| Audio converter | `convert` | Media | audio, mp3, convert, youtube, video |

The 8 new tools (registered by their own specs) seed as: HEIC convert, image
compress/resize, background removal → Images; PDF merge/split/compress →
Documents; video compression, concat video/audio → Media; QR generation →
Events; certificate/badge mail-merge → Events + Documents.

### 2. User state store (`components/tool-store.ts`, `localStorage`)

One key, `ee.toolShell`, holding a versioned JSON blob:

```ts
type ToolShellState = {
  version: 1;
  groups: string[];                    // ordered group ids incl. custom; Favourites implicit-first, not stored in this array
  groupLabels: Record<string, string>; // id -> display name (for renamed/custom)
  membership: Record<string, string[]>;// toolId -> group ids (overrides defaultGroups when present)
  favourites: string[];                // toolId list
};
```

Rules:
- **Favourites** is a reserved group id (`"fav"`), always rendered first, never
  in `groups`, never deletable. A card is in it iff its id is in `favourites`.
- On first run (no stored blob) the store derives initial `groups`,
  `groupLabels`, and `membership` from the registry's `defaultGroups`.
- `membership[toolId]` present → authoritative for that tool. Absent → fall back
  to the tool's `defaultGroups`. This lets new tools appear via their seed
  without the store needing to know about them ahead of time.
- Deleting a group removes it from `groups`/`groupLabels` and strips its id from
  every `membership` entry. Cards are never deleted, only unassigned.
- A custom group with no cards still renders (empty state); it persists until
  deleted.
- Mirror the existing pattern: a `writeToolShell()` that sets the key and
  dispatches a `ee:tool-shell-change` event; `readToolShell()` for hydration;
  a change listener in the shell components.

### 3. Topbar (`components/Nav.tsx`)

Reuse the sliding-thumb mechanics wholesale (`translateX`/width/top/height,
`navShouldAnimate`, reduced-motion guard). Change what the pills represent:

- Pills are now `[Favourites, ...groups]`. No Home/Settings/tool pills in the
  scrolling row. Home and Settings move to fixed affordances (Home = the app
  wordmark/logo click; Settings = a pinned gear at the row's right end, outside
  the thumb track). Confirm exact placement during planning against
  `app/layout.tsx`.
- Active group is tracked in shell state (React state lifted to a context or the
  layout), not the URL, since filtering is in-place on Home. Default active =
  `fav`.
- Clicking a group while on a tool route navigates to `/` and sets that group
  active.
- The row stays `overflow-x-auto` for many groups; the thumb math already
  handles offset positioning.

### 4. Home grid + filter (`app/page.tsx`, `components/ToolGrid.tsx`)

`app/page.tsx` becomes a thin server component rendering a client `ToolGrid`.
`ToolGrid`:

- Reads the registry + store, computes the visible set = tools whose effective
  membership includes the active group (or `favourites` for `fav`).
- Renders the existing responsive grid of `ToolCard`s.
- When a search query is active it overrides the group filter (see §6).
- Empty state when a group has zero cards ("No tools in this group yet") and
  when search returns nothing ("No tools match 'x'").
- Card removal from the active group animates out (height/opacity collapse,
  reduced-motion respected).

### 5. Card + popover (`components/ToolCard.tsx`, `components/CardMenu.tsx`)

`ToolCard` additions:
- A tag row beneath the body: small neutral pills, tags truncated to a sensible
  max (e.g. first 4, "+N" if more). Non-interactive here; they exist for search
  and at-a-glance scanning.
- A "⋯" button top-right of the card. Clicking it opens `CardMenu` (a popover)
  and does not navigate. The card body remains a `Link` to the tool.

`CardMenu` popover contents:
- Favourite toggle (★ filled/outline) → updates `favourites`.
- A checkbox per existing group (excluding Favourites, which is the star) →
  updates `membership[toolId]`.
- "+ New group…" inline text field → creates a group (append to `groups`, set
  label, add this tool to it) and ticks it.
- Closes on outside-click / Escape. Anchored to the card, flips if near viewport
  edge.

Follow the house design system (anti-vibecode): one accent, neutral rest, soft
shadows, sentence-case labels, no em dashes.

### 6. Search (`components/ToolSearch.tsx`)

- A search input in its own bar directly below the sticky topbar.
- **Reveal-on-scroll-up behaviour**: at scrollTop 0 the bar is visible. Scrolling
  down past a small threshold translates it up behind the topbar (hidden);
  scrolling up brings it back. Implement with a scroll listener tracking last
  scrollY + direction, toggling a `translateY(-100%)`/`0` class with a short
  transition. The topbar itself stays sticky and always visible. Respect
  reduced-motion (snap instead of slide).
- Typing sets the query in shell/UI state. While non-empty, `ToolGrid` ignores
  the active group and shows all tools whose `tags`, `title`, or `body` contain
  the query (substring, case-insensitive, trimmed). Clearing restores the group
  view. The active group pill stays visually selected but dimmed while a query
  is live.

### 7. Settings: group management (`app/settings/NavOrder.tsx` → group manager)

Repurpose the existing drag-reorder UI:
- Reorder the group pills (Favourites pinned first, not draggable).
- Rename a group (inline edit of `groupLabels`).
- Delete a custom group (with a confirm; seeded defaults deletable too, since
  the model treats all non-Favourites groups uniformly — confirm this is
  desired during planning, else mark defaults undeletable).
- Reuse the jiggle-in-edit-mode affordance already built.

## Testing

- `tool-store` unit tests: first-run derivation from registry defaults;
  membership override vs fallback; favourite toggle; group create/rename/delete
  strips membership; unknown-tool fallback; version guard on malformed blobs.
- Search predicate unit test: matches on tag, title, body; case/trim; empty
  query returns group view.
- Topbar thumb: existing `nav-anim` tests stay green; add a case for the
  group-pill index mapping if logic changes.
- Manual: reveal-on-scroll behaviour, popover multi-assign, empty states, filter
  animation, reduced-motion.

## Open items for planning

- Exact Home + Settings placement once the topbar is groups-only.
- Whether seeded default groups are deletable (§7) — default to yes for a
  uniform model unless we want them protected.
- Where active-group + search-query state lives (layout context vs a small
  store) so both the topbar and grid read it.
