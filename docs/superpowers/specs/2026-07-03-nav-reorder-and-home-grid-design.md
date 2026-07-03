# Nav reorder + home grid redesign

Date: 2026-07-03
Package: `packages/web`
Status: approved, ready to plan

## Problem

- The top nav feels laggy. Every route change animates a sliding "thumb", fades
  the label text to invisible mid-slide, then fires a 6-star particle burst on
  transition-end. The animation blocks the sense that the click registered.
- The home page is a horizontal snap-scroll carousel. Cards past the viewport
  edge are hidden; users have to scroll sideways to see all four tools.
- Each card carries a 3-icon circular cluster on its illustration that adds
  visual noise without adding meaning.

## Goals

1. Make the nav feel instant while keeping a light, readable slide.
2. Let the user reorder the tool pills, configured from Settings, with an
   iOS-style jiggle in edit mode.
3. Show all home cards in the viewport at once (grid, not carousel).
4. Simplify each card: one primary icon beside the title, no circular cluster,
   slightly smaller body text.
5. On hover, each card's illustration plays a short animation that hints at what
   the tool does.

Non-goals:
- No drag-reorder on the live nav bar itself (Settings is the only reorder UI).
- Home and Settings pills are pinned; they do not move.
- No new runtime dependency (Turbopack value-import rules make dnd libs painful).

## Design

### 1. Nav latency (`components/Nav.tsx`, `components/nav-anim.ts`)

Keep the sliding thumb, strip everything that delays feedback.

- Reduce the thumb transition to ~120ms (fast glide). The thumb `translateX` /
  width / top / height positioning logic stays.
- Delete `burst()`, the `STAR` svg constant, `fxRef` and its overlay `<span>`,
  and the `transitionend` listener that triggered the burst.
- Delete the `settledIdx` state, `activeIdxRef`, and the text-unsettle logic.
  Active pill text is `text-white` immediately; inactive pills stay
  `text-muted hover:text-ink` and remain readable for the whole slide.
- `nav-anim.ts`: keep `navShouldAnimate` and `bestMatchIndex`; remove
  `shouldUnsettle`.
- `test/nav-anim.test.ts`: drop the `shouldUnsettle` cases; keep
  `navShouldAnimate` and `bestMatchIndex` coverage.

### 2. Configurable nav order (`components/nav-links.ts` new, `Nav.tsx`, Settings)

Single source of truth extracted to `components/nav-links.ts`:

```
HOME     = { href: "/",         label: "Home",              Icon: Home }      // pinned first
SETTINGS = { href: "/settings", label: "Settings",          Icon: Settings }  // pinned last
TOOL_LINKS = [                                                                  // reorderable, this is the default order
  { href: "/sorter",     label: "Photo sorter",     Icon: Images },
  { href: "/transcribe", label: "Audio transcriber", Icon: Mic },
  { href: "/studio",     label: "Headshot studio",  Icon: UserRound },
  { href: "/slice",      label: "Slide slicer",     Icon: Scissors },
]
```

Order store (same file, client-only helpers):

- localStorage key `ee.navOrder` = JSON array of tool hrefs.
- `readNavOrder(): ToolLink[]` — returns `TOOL_LINKS` reordered by the stored
  href list. Unknown/missing hrefs are dropped; tools absent from storage are
  appended in default order (so adding a new tool later still shows up). On any
  parse error or non-browser context, returns `TOOL_LINKS` unchanged.
- `writeNavOrder(hrefs: string[]): void` — persists and dispatches a
  `window` CustomEvent `"ee:nav-order-change"`.
- `NAV_ORDER_EVENT = "ee:nav-order-change"` exported constant.

`Nav.tsx`:

- Renders `HOME`, then `orderedTools`, then `SETTINGS`.
- `orderedTools` state initialised to `TOOL_LINKS` (SSR-safe default — first
  paint is deterministic, matches server HTML), then set from `readNavOrder()`
  in a mount `useEffect`, avoiding hydration mismatch.
- Subscribes to `NAV_ORDER_EVENT` on `window`; on fire, re-reads order so the
  live nav updates the moment the user saves in Settings (same-tab; the native
  `storage` event does not fire in the originating tab).
- `linkRefs` array length now tracks the full rendered list (Home + tools +
  Settings). The thumb still positions off `linkRefs.current[activeIdx]` where
  `activeIdx = bestMatchIndex(renderedHrefs, path)`.

Settings **Navigation order** section (`app/settings/NavOrder.tsx` new client
component, rendered from `app/settings/page.tsx`):

- Heading "Navigation order" + helper line ("Drag the tools to reorder them.
  Home and Settings stay put.").
- Renders pinned `Home` (dimmed) · draggable tool pills · pinned `Settings`
  (dimmed), styled like the real nav pills.
- **Edit** button toggles edit mode. In edit mode:
  - Tool pills get a subtle continuous jiggle (CSS keyframe, small rotate +
    translate), disabled under `prefers-reduced-motion` (static, still
    draggable).
  - Pointer-drag reorder, hand-rolled (pointerdown/move/up): the dragged pill
    follows the pointer via `transform`; when its centre crosses a neighbour's
    midpoint, swap indices and let the others transition to their new slots
    ("shift around"). No HTML5 DnD (avoids its ghost-image/jank).
  - Button label becomes **Done**; clicking it calls `writeNavOrder(order)` and
    exits edit mode.
- Local component state holds the working order; persistence only on Done.

### 3. Home grid (`app/page.tsx`, `components/ToolCard.tsx`)

- `page.tsx`: replace the `overflow-x-auto` + `snap-x` carousel wrapper with a
  responsive grid: `grid grid-cols-1 gap-5 sm:grid-cols-2`. 2×2 on desktop,
  single column when narrow.
- `ToolCard.tsx`: drop `w-80 flex-none snap-start`; card fills its grid cell
  (`block h-full`). Keep the rounded border/surface/soft-shadow styling and the
  `hover:border-muted/40` affordance.

### 4. Card simplification (`ToolCard.tsx`, `app/page.tsx`)

- `ToolCard` prop change: `icons: LucideIcon[]` → `Icon: LucideIcon`.
- Remove the absolutely-positioned 3-icon circular cluster from the illustration
  box entirely.
- Title row: `<Icon size={18} strokeWidth={1.75}>` inline-flex beside the `<h2>`
  title (icon then title, `gap-2`, `items-center`).
- Body: `text-sm` → `text-[13px]` (keep `text-muted`, keep `mt-1.5`).
- `page.tsx` `TOOLS` entries: replace `icons: [...]` with a single `Icon`:
  Sorter → `Images`, Studio → `UserRound`, Transcribe → `Mic`, Slice →
  `Scissors`. Drop now-unused icon imports.

### 5. Hover animations (`components/tool-illustrations.tsx`, `ToolCard.tsx`)

- `ToolCard` root `<Link>` gets the `group` class so illustrations can react to
  `group-hover`.
- Each illustration adds a CSS-only `group-hover` micro-animation, all wrapped
  so they are inert under `prefers-reduced-motion: reduce` (use Tailwind
  `motion-safe:` variants or a `motion-reduce:` guard):
  - **Sorter** — the tile holding the "#1" badge scales up (~1.08) and the other
    tiles drop opacity, reading as "ranked best-first".
  - **Studio** — the gradient brand bar grows from short to full width and a thin
    accent crop-frame draws around the avatar square.
  - **Transcribe** — the waveform bars animate to an equalizer (staggered height
    pulse) and the two text lines wipe in left→right (width 0 → full).
  - **Slice** — the three panels nudge apart (small x-translate outward) and the
    dashed cut-lines sweep down into place.
- Animations are short (~300-500ms), ease-out, and settle to a resting state
  while hovered; they reset on hover-out. No JS timers — pure CSS transitions /
  keyframes triggered by the `group-hover` state.

## Files touched

- `packages/web/components/Nav.tsx` — strip burst/unsettle, light slide, ordered tools, event subscribe.
- `packages/web/components/nav-anim.ts` — remove `shouldUnsettle`.
- `packages/web/test/nav-anim.test.ts` — drop `shouldUnsettle` cases.
- `packages/web/components/nav-links.ts` — NEW: link constants + order store + event.
- `packages/web/app/settings/NavOrder.tsx` — NEW: edit-mode reorder UI.
- `packages/web/app/settings/page.tsx` — render `NavOrder` section.
- `packages/web/app/page.tsx` — grid layout, single `Icon` per tool.
- `packages/web/components/ToolCard.tsx` — grid-fill card, one title-icon, smaller body, `group`.
- `packages/web/components/tool-illustrations.tsx` — hover micro-animations.

## Testing

- Unit: `nav-anim.test.ts` stays green after `shouldUnsettle` removal.
- Unit (new): `nav-links.test.ts` — `readNavOrder` reorders by stored hrefs,
  drops unknown hrefs, appends missing tools in default order, falls back to
  default on bad JSON.
- Manual (`npm run dev`): click through every nav pill (fast slide, readable
  text, no stars); Settings → Edit → drag to reorder → Done → nav reflects new
  order immediately and survives reload; home shows all 4 cards without
  horizontal scroll; hover each card to see its animation; verify
  reduced-motion disables jiggle + hover animations.

## House rules

Anti-vibecode standards apply: one accent colour, neutral rest, soft shadows,
sentence-case labels, no em dashes in UI copy. Reuse existing tokens
(`bg-ink`, `text-muted`, `shadow-soft`, `border-line`, `text-[13px]`/`text-sm`).
