# event-editor UI pass

Date: 2026-07-03
Status: Approved design (board + motion prototype signed off), pending implementation plan
Scope: `packages/web` chrome and home (Nav, home page, studio, favicon, icons)

## Problem

Six UI changes, gathered and approved with a direction board and an interactive
motion prototype:

1. Home leads with a redundant heading block ("Four tools, one workspace" /
   "What do you want to do") that adds nothing.
2. The active nav item is a flat light pill. It should be the dark pill from the
   reference, and it should *move*: slide from the previously-selected item to the
   new one, then pop a few black stars when it lands.
3. Icons are already all lucide-react (Feather geometry), but stroke width and
   sizes are set ad hoc. Normalize them.
4. Batch is its own route (`/studio/batch`) with a nav entry. It should fold into
   the Headshot studio page as a Single / Batch switch.
5. There is no favicon at all. Add one: an "ee" monogram on a dark rounded square.
6. The home tool cards are a plain 2-column grid. Rebuild them in the reference
   style (an illustration that previews what each tool makes, a row of round action
   icons, then title and description) as a horizontal scroll-snap carousel.

Reference artifacts (approved by Caleb):
- Direction board: https://claude.ai/code/artifact/540c6d33-19ad-425a-904c-e870fa4c4087
- Nav motion prototype (v2, tuned): https://claude.ai/code/artifact/90a372a7-700a-4f4c-b5a5-e54ebe734377

## Existing design system (honor it)

From `tailwind.config.ts` / `globals.css`: accent `#3b6cf6`, canvas `#f5f6f8`,
surface/raised `#ffffff`, line `#e4e7ec`, ink `#1a1d23`, muted `#5f6b7a`, success
`#16a34a`, danger `#b42318`; radius `card: 14px`; shadows `soft` and `raisededge`;
font DM Sans. House classes: `.btn`, `.btn-accent`, `.card`, `.eyebrow`, `.field`.
All icons are lucide-react. Everything below reuses these tokens and classes.

## Design

### 1. Remove the home heading

`app/page.tsx`: delete the `<p className="eyebrow">Four tools, one workspace</p>`
and `<h1 …>What do you want to do</h1>`. The card carousel (item 6) becomes the top
of the page. No replacement heading.

### 2. Nav: dark pill + slide + star burst

`components/Nav.tsx` (already a client component using `usePathname()`).

**Dark pill.** The active link's classes change from
`bg-raised text-ink shadow-raisededge` to a solid near-black pill:
`bg-ink text-white` with a soft shadow. Inactive links stay `text-muted hover:text-ink`.

**Sliding thumb (FLIP).** Replace per-link background with a single absolutely
positioned "thumb" element behind the links (`position:absolute; border-radius:11px;
background:var(--ink); z-index:0`, links `z-index:1`). A `useLayoutEffect` keyed on
`pathname` measures the active link's `offsetLeft/Top/Width/Height` and writes them to
the thumb (`transform: translateX(...)`, `width`, `top`, `height`). A CSS transition on
`transform` and `width` animates the move automatically when the active link changes:
- `transition: transform .52s cubic-bezier(.25,1.12,.32,1), width .52s cubic-bezier(.3,.8,.3,1)`
  (the approved tuned feel: soft, slight overshoot, slow settle).

Because Nav lives in the root layout it stays mounted across client navigations, so
the thumb genuinely slides between routes. Two guards:
- **No animation / no burst on first paint or hard load.** Position the thumb without
  the transition class on mount, then add the transition class on the next frame. Track
  the previous pathname in a ref; only animate + burst when the pathname actually
  *changes* from a prior value (not on initial mount).
- **Reduced motion.** If `matchMedia('(prefers-reduced-motion: reduce)').matches`, skip
  the transition (snap) and skip the burst.

**Star burst.** On the thumb's `transitionend` for `propertyName === 'transform'`,
spawn 6 small filled-black star SVGs at the active link's center in an overlay layer
(`pointer-events:none`), animated outward via the Web Animations API (radial spread
~30–54px, a scale up then down, opacity to 0, slight rotation, ~620ms ease-out),
removing each on finish. Suppressed under reduced motion. This is the exact behavior in
the approved prototype; port it into the component.

The `/studio/batch` entry is removed from the `LINKS` array (batch folds into studio,
item 4).

### 3. Normalize icons

Icons are already 100% lucide-react, so this is a consistency pass, not a migration.
Standardize stroke width to `strokeWidth={1.75}` and keep sizes tied to the adjacent
text on the visible clusters: Nav icons (`size={18}`), card action icons, and the
in-tool button icons (`StatusBadge`, `CopyButton`, `FileDrop`, `SliceClient`,
`EventDetailsPanel`). No icon-library change, no new dependency.

### 4. Fold Batch into Headshot studio

`app/studio/page.tsx` keeps its server-side Google-configured gate. When configured,
instead of rendering `<StudioClient />` directly it renders a new client component
`StudioTabs` that holds a Single / Batch **segmented control** (same pill pattern as the
slicer's mode switch: a bordered inline-flex with `bg-raised text-ink shadow-raisededge`
on the active option) and renders `<StudioClient />` or `<StudioBatchClient />`
accordingly. Default is Single. `StudioBatchClient` is imported from its existing
location (`app/studio/batch/StudioBatchClient.tsx`); its logic is unchanged.

`app/studio/batch/page.tsx` becomes a `redirect("/studio")` so any bookmark still lands
somewhere sensible. The batch heading ("Batch from a sheet") moves inside the Batch tab
as a section label rather than a page `<h1>`.

### 5. Favicon

Add `app/icon.svg` (Next file-convention favicon; none exists today). A dark rounded
square (`#1a1d23`, ~22% corner radius) with a white "ee" monogram. Render the "ee" as
vector paths for pixel determinism at favicon sizes (fallback acceptable: an SVG
`<text>` in a sans stack, since the glyph nuance is imperceptible at 16–32px). Update
`app/layout.tsx` metadata `title`/`description` only if needed; the icon is picked up by
file convention, no `icons` field required.

### 6. Home cards → illustrated carousel

`app/page.tsx`: replace the `grid gap-5 sm:grid-cols-2` of text `ToolCard`s with a
horizontal scroll-snap rail (`display:flex; overflow-x:auto; scroll-snap-type:x
mandatory; gap`), cards `flex:0 0 ~320px; scroll-snap-align:start`. A 5th/6th tool just
extends the rail.

Each card (rebuilt `ToolCard`):
- **Illustration panel** (grey fill, rounded, ~190px tall) with tool-specific greyed
  placeholder content that previews what the tool produces, matching the approved board:
  - Photo sorter: a grid of photo tiles with a `#1` rank badge (accent) on the top tile.
  - Headshot studio: a portrait tile + a thin brand strip.
  - Audio transcriber: a small waveform over two transcript lines.
  - Slide slicer: three slide rectangles with dashed split lines and a small
    "confidential" tag.
- **Icon row**: 3 round white action icons floated at the illustration's bottom-left
  (lucide, `strokeWidth={1.75}`), per tool (e.g. slicer: layers / scissors / shield).
- **Title** (bold) + **description** (muted), reusing the existing per-tool copy.

The four tools and hrefs are unchanged: `/sorter`, `/studio`, `/transcribe`, `/slice`.
Card data (href, title, description, illustration variant, icon set) lives in a single
array so the rail is data-driven.

## Testing

This pass is almost entirely presentational, so verification is typecheck plus manual:
- `cd packages/web && npx tsc --noEmit`: no NEW errors beyond the 5 known pre-existing
  ones (`test/docs.test.ts`, `test/canva-oauth.test.ts`).
- `npm -w @event-editor/web run build`: Next build succeeds (catches the new
  `app/icon.svg`, the `StudioTabs` client boundary, and the batch redirect).
- Manual browser check: nav pill slides + bursts on route change and snaps under
  reduced motion; home shows the carousel and scrolls; studio Single/Batch toggle
  switches flows and `/studio/batch` redirects; favicon shows the "ee" tile.

No new unit tests: there is no meaningful pure logic to extract (the nav motion is
DOM/animation, the carousel and toggle are markup and state). If the nav's
prev-pathname/animate-guard logic is pulled into a small pure helper, it gets a unit
test; otherwise it is manual-verified.

## Out of scope (YAGNI)

- Changing tool copy or adding/removing tools.
- Restyling in-tool screens (sorter/transcribe/slice bodies) beyond the icon-stroke pass.
- Persisting a Single/Batch preference; it resets to Single per visit.
- Animating the carousel (scroll only); no autoplay.
