# Nav reorder + home grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the top nav feel instant and reorderable, and turn the home carousel into a full-viewport card grid with simpler cards and hover animations.

**Architecture:** Extract nav links + a localStorage-backed order store into a shared client module. `Nav.tsx` keeps a fast sliding thumb (no particle burst, no text-fade) and renders tools in saved order, updating live via a custom event fired from a new Settings edit-mode reorder UI. Home swaps its horizontal snap-carousel for a responsive grid; cards lose the 3-icon cluster for one title icon and gain CSS-only hover animations.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind, lucide-react, Vitest.

## Global Constraints

- Package: `packages/web`. Run all commands from `packages/web`.
- Test runner: `vitest run`. Path alias `@/` maps to `packages/web`.
- No new runtime dependency (Turbopack value-import rules — hand-roll drag).
- Anti-vibecode house rules: one accent colour, neutral rest, soft shadows,
  sentence-case labels, no em dashes in UI copy. Reuse existing tokens
  (`bg-ink`, `bg-surface`, `text-muted`, `text-ink`, `shadow-soft`,
  `border-line`).
- All motion gated on `prefers-reduced-motion` (Tailwind `motion-safe:` /
  `motion-reduce:` or a media-query guard).

---

### Task 1: Nav links + order store module

**Files:**
- Create: `packages/web/components/nav-links.ts`
- Test: `packages/web/test/nav-links.test.ts`

**Interfaces:**
- Produces:
  - `type NavLink = { href: string; label: string; Icon: LucideIcon }`
  - `HOME: NavLink`, `SETTINGS: NavLink`, `TOOL_LINKS: NavLink[]`
  - `NAV_ORDER_KEY = "ee.navOrder"`, `NAV_ORDER_EVENT = "ee:nav-order-change"`
  - `orderTools(stored: string[]): NavLink[]`
  - `parseNavOrder(raw: string | null): NavLink[]`
  - `readNavOrder(): NavLink[]`
  - `writeNavOrder(hrefs: string[]): void`

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/nav-links.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { orderTools, parseNavOrder, TOOL_LINKS } from "@/components/nav-links";

const hrefs = (links: { href: string }[]) => links.map((l) => l.href);
const DEFAULT = ["/sorter", "/transcribe", "/studio", "/slice"];

describe("orderTools", () => {
  it("returns default order for an empty list", () => {
    expect(hrefs(orderTools([]))).toEqual(DEFAULT);
  });
  it("reorders by the stored href list", () => {
    expect(hrefs(orderTools(["/slice", "/studio", "/transcribe", "/sorter"]))).toEqual([
      "/slice",
      "/studio",
      "/transcribe",
      "/sorter",
    ]);
  });
  it("drops unknown hrefs", () => {
    expect(hrefs(orderTools(["/slice", "/nope", "/sorter"]))).toEqual([
      "/slice",
      "/sorter",
      "/transcribe",
      "/studio",
    ]);
  });
  it("appends tools missing from storage in default order", () => {
    expect(hrefs(orderTools(["/slice"]))).toEqual([
      "/slice",
      "/sorter",
      "/transcribe",
      "/studio",
    ]);
  });
  it("ignores duplicate hrefs", () => {
    expect(hrefs(orderTools(["/slice", "/slice", "/sorter"]))).toEqual([
      "/slice",
      "/sorter",
      "/transcribe",
      "/studio",
    ]);
  });
});

describe("parseNavOrder", () => {
  it("returns default order for null", () => {
    expect(hrefs(parseNavOrder(null))).toEqual(DEFAULT);
  });
  it("returns default order for malformed JSON", () => {
    expect(hrefs(parseNavOrder("{not json"))).toEqual(DEFAULT);
  });
  it("returns default order when JSON is not an array", () => {
    expect(hrefs(parseNavOrder('{"a":1}'))).toEqual(DEFAULT);
  });
  it("reorders from a valid JSON array", () => {
    expect(hrefs(parseNavOrder('["/slice","/studio","/transcribe","/sorter"]'))).toEqual([
      "/slice",
      "/studio",
      "/transcribe",
      "/sorter",
    ]);
  });
  it("keeps TOOL_LINKS default order stable", () => {
    expect(hrefs(TOOL_LINKS)).toEqual(DEFAULT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- nav-links`
Expected: FAIL — cannot resolve `@/components/nav-links`.

- [ ] **Step 3: Write the module**

Create `packages/web/components/nav-links.ts`:

```ts
"use client";
import { Home, Images, Mic, UserRound, Settings, Scissors, type LucideIcon } from "lucide-react";

export type NavLink = { href: string; label: string; Icon: LucideIcon };

export const HOME: NavLink = { href: "/", label: "Home", Icon: Home };
export const SETTINGS: NavLink = { href: "/settings", label: "Settings", Icon: Settings };

// Default order; reorderable via the store below.
export const TOOL_LINKS: NavLink[] = [
  { href: "/sorter", label: "Photo sorter", Icon: Images },
  { href: "/transcribe", label: "Audio transcriber", Icon: Mic },
  { href: "/studio", label: "Headshot studio", Icon: UserRound },
  { href: "/slice", label: "Slide slicer", Icon: Scissors },
];

export const NAV_ORDER_KEY = "ee.navOrder";
export const NAV_ORDER_EVENT = "ee:nav-order-change";

// Reorder TOOL_LINKS by a stored href list. Unknown/duplicate hrefs are dropped;
// tools absent from the list are appended in default order.
export function orderTools(stored: string[]): NavLink[] {
  const byHref = new Map(TOOL_LINKS.map((l) => [l.href, l]));
  const seen = new Set<string>();
  const out: NavLink[] = [];
  for (const href of stored) {
    const link = byHref.get(href);
    if (link && !seen.has(href)) {
      out.push(link);
      seen.add(href);
    }
  }
  for (const link of TOOL_LINKS) {
    if (!seen.has(link.href)) out.push(link);
  }
  return out;
}

export function parseNavOrder(raw: string | null): NavLink[] {
  if (!raw) return TOOL_LINKS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return TOOL_LINKS;
    return orderTools(parsed.filter((h): h is string => typeof h === "string"));
  } catch {
    return TOOL_LINKS;
  }
}

export function readNavOrder(): NavLink[] {
  if (typeof window === "undefined") return TOOL_LINKS;
  return parseNavOrder(window.localStorage.getItem(NAV_ORDER_KEY));
}

export function writeNavOrder(hrefs: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(hrefs));
  window.dispatchEvent(new CustomEvent(NAV_ORDER_EVENT));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- nav-links`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/nav-links.ts packages/web/test/nav-links.test.ts
git commit -m "feat(web): nav links + localStorage order store"
```

---

### Task 2: Strip nav latency + render ordered tools

**Files:**
- Modify: `packages/web/components/nav-anim.ts` (remove `shouldUnsettle`)
- Modify: `packages/web/test/nav-anim.test.ts` (drop `shouldUnsettle` cases)
- Modify: `packages/web/components/Nav.tsx` (full rewrite below)
- Reference: `packages/web/app/globals.css` (check `.nav-thumb` transition)

**Interfaces:**
- Consumes: `HOME`, `SETTINGS`, `TOOL_LINKS`, `readNavOrder`, `NAV_ORDER_EVENT`
  from Task 1; `navShouldAnimate`, `bestMatchIndex` from `nav-anim.ts`.

- [ ] **Step 1: Confirm the thumb transition duration**

Run: `grep -n "nav-thumb" packages/web/app/globals.css`
If `.nav-thumb` sets a `transition`, note it; Step 4 sets it to `120ms`. If the
transition lives inline in `Nav.tsx` instead, handle it there in Step 5.

- [ ] **Step 2: Remove `shouldUnsettle` from nav-anim + its tests**

Edit `packages/web/components/nav-anim.ts` — delete the `shouldUnsettle`
function entirely, leaving `navShouldAnimate` and `bestMatchIndex`.

Edit `packages/web/test/nav-anim.test.ts` — remove `shouldUnsettle` from the
import on line 2 and delete its `describe(...)` block. Leave the rest.

- [ ] **Step 3: Run the nav-anim tests**

Run: `npm test -- nav-anim`
Expected: PASS (no `shouldUnsettle` references remain).

- [ ] **Step 4: Set the thumb to a fast glide**

In `packages/web/app/globals.css`, ensure `.nav-thumb` transitions transform +
width + position over 120ms:

```css
.nav-thumb {
  transition: transform 120ms ease, width 120ms ease, top 120ms ease, height 120ms ease;
}
```

(If a `.nav-thumb` rule already exists, edit its `transition` to the above
rather than adding a duplicate.)

- [ ] **Step 5: Rewrite `Nav.tsx`**

Replace `packages/web/components/Nav.tsx` entirely with:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { navShouldAnimate, bestMatchIndex } from "@/components/nav-anim";
import { HOME, SETTINGS, TOOL_LINKS, readNavOrder, NAV_ORDER_EVENT, type NavLink } from "@/components/nav-links";

export function Nav() {
  const path = usePathname();
  const [tools, setTools] = useState<NavLink[]>(TOOL_LINKS);
  const links: NavLink[] = [HOME, ...tools, SETTINGS];
  const activeIdx = bestMatchIndex(links.map((l) => l.href), path);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const prevPath = useRef<string | null>(null);
  const enabled = useRef(false);
  const [motionOK, setMotionOK] = useState(false);

  useEffect(() => {
    setMotionOK(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setTools(readNavOrder());
    const onOrder = () => setTools(readNavOrder());
    window.addEventListener(NAV_ORDER_EVENT, onOrder);
    return () => window.removeEventListener(NAV_ORDER_EVENT, onOrder);
  }, []);

  useLayoutEffect(() => {
    const el = linkRefs.current[activeIdx];
    const thumb = thumbRef.current;
    if (!el || !thumb) return;
    const willAnimate = navShouldAnimate(prevPath.current, path) && motionOK && enabled.current;
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
    prevPath.current = path;
    // Re-runs when `tools` changes so the thumb re-seats after a reorder.
  }, [path, activeIdx, motionOK, tools]);

  return (
    <header className="relative border-b border-line">
      <nav className="relative mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-6 py-3">
        <span ref={thumbRef} aria-hidden className="nav-thumb pointer-events-none absolute left-0 top-0 z-0 rounded-lg bg-ink" />
        {links.map(({ href, label, Icon }, i) => {
          const active = i === activeIdx;
          return (
            <Link
              key={href}
              href={href}
              ref={(el) => {
                linkRefs.current[i] = el;
              }}
              aria-current={active ? "page" : undefined}
              className={`relative z-10 inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "text-white" : "text-muted hover:text-ink"
              }`}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
```

Key changes vs the old file: no `fxRef`/burst/`STAR`, no `settledIdx`/
`shouldUnsettle`, no `transitionend` listener. Active label is `text-white`
immediately; inactive stays readable throughout the 120ms slide. The `tools`
dependency on the layout effect re-seats the thumb after a reorder. No stale-ref
handling is needed: `activeIdx = bestMatchIndex(links...)` always indexes a
currently-rendered link, and React clears unused array slots as the list
shrinks.

Note the existing `.nav-thumb` rule (Step 4) currently animates over `.52s` with
a spring curve and only covers `transform`/`width` — that slow spring is the
main source of the perceived latency. Step 4 replaces it wholesale with the
120ms four-property rule.

- [ ] **Step 6: Run the full web test suite**

Run: `npm test`
Expected: PASS (nav-anim + nav-links green, nothing references removed symbols).

- [ ] **Step 7: Typecheck / build the nav**

Run: `npx tsc --noEmit`
Expected: no errors from `Nav.tsx` / `nav-anim.ts`.

- [ ] **Step 8: Commit**

```bash
git add packages/web/components/Nav.tsx packages/web/components/nav-anim.ts \
  packages/web/test/nav-anim.test.ts packages/web/app/globals.css
git commit -m "perf(web): fast readable nav slide, render tools in saved order"
```

---

### Task 3: Settings navigation-order edit mode

**Files:**
- Create: `packages/web/app/settings/NavOrder.tsx`
- Modify: `packages/web/app/settings/page.tsx` (render the section)

**Interfaces:**
- Consumes: `HOME`, `SETTINGS`, `readNavOrder`, `writeNavOrder`,
  `type NavLink` from `nav-links.ts`.

- [ ] **Step 1: Write the reorder component**

Create `packages/web/app/settings/NavOrder.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { HOME, SETTINGS, readNavOrder, writeNavOrder, type NavLink } from "@/components/nav-links";

function Pill({ link, dimmed, jiggle }: { link: NavLink; dimmed?: boolean; jiggle?: boolean }) {
  const { Icon, label } = link;
  return (
    <span
      className={`inline-flex select-none items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-soft ${
        dimmed ? "text-muted opacity-60" : "text-ink"
      } ${jiggle ? "motion-safe:animate-[nav-jiggle_0.3s_ease-in-out_infinite]" : ""}`}
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden />
      {label}
    </span>
  );
}

export function NavOrder() {
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<NavLink[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOrder(readNavOrder());
  }, []);

  function onPointerDown(e: React.PointerEvent, i: number) {
    if (!editing) return;
    e.preventDefault();
    setDragIdx(i);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragIdx === null || !rowRef.current) return;
    const pills = Array.from(rowRef.current.querySelectorAll<HTMLElement>("[data-pill]"));
    const x = e.clientX;
    let target = dragIdx;
    pills.forEach((p, j) => {
      const r = p.getBoundingClientRect();
      if (x > r.left + r.width / 2) target = Math.max(target, j);
      if (x < r.left + r.width / 2 && j <= dragIdx) target = Math.min(target, j);
    });
    if (target !== dragIdx) {
      setOrder((prev) => {
        const next = prev.slice();
        const [moved] = next.splice(dragIdx, 1);
        next.splice(target, 0, moved);
        return next;
      });
      setDragIdx(target);
    }
  }

  function onPointerUp() {
    setDragIdx(null);
  }

  function toggle() {
    if (editing) writeNavOrder(order.map((l) => l.href));
    setEditing((v) => !v);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Navigation order</h2>
          <p className="mt-1 text-sm text-muted">
            Drag the tools to reorder them. Home and Settings stay put.
          </p>
        </div>
        <button type="button" className="btn" onClick={toggle}>
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      <div
        ref={rowRef}
        className="mt-4 flex flex-wrap items-center gap-2"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <Pill link={HOME} dimmed />
        {order.map((link, i) => (
          <span
            key={link.href}
            data-pill
            onPointerDown={(e) => onPointerDown(e, i)}
            className={`${editing ? "cursor-grab touch-none" : ""} ${dragIdx === i ? "opacity-70" : ""} transition-transform`}
          >
            <Pill link={link} jiggle={editing && dragIdx !== i} />
          </span>
        ))}
        <Pill link={SETTINGS} dimmed />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the jiggle keyframe**

In `packages/web/app/globals.css`, add:

```css
@keyframes nav-jiggle {
  0% { transform: rotate(-1.4deg) translateY(-0.5px); }
  50% { transform: rotate(1.4deg) translateY(0.5px); }
  100% { transform: rotate(-1.4deg) translateY(-0.5px); }
}
```

- [ ] **Step 3: Render the section in Settings**

In `packages/web/app/settings/page.tsx`:
- Add the import near the other section imports:
  ```tsx
  import { NavOrder } from "./NavOrder";
  ```
- Render the section after the Connections `<ul>` blocks and before the
  "Draft style and inspiration" heading (line 72-73 region):
  ```tsx
  <div className="mt-10">
    <NavOrder />
  </div>
  ```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verify in dev**

Run: `npm run dev`, open `http://localhost:3000/settings`.
- Section shows Home (dimmed) · four tool pills · Settings (dimmed).
- Click **Edit** → tool pills jiggle (unless reduced-motion).
- Drag a tool across a neighbour → order updates, others shift.
- Click **Done** → nav bar at top reflects the new tool order immediately.
- Reload → order persists.

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/settings/NavOrder.tsx packages/web/app/settings/page.tsx \
  packages/web/app/globals.css
git commit -m "feat(web): settings edit-mode nav reorder with jiggle + drag"
```

---

### Task 4: Home grid + card simplification

**Files:**
- Modify: `packages/web/components/ToolCard.tsx`
- Modify: `packages/web/app/page.tsx`

**Interfaces:**
- `ToolCard` new prop shape:
  `{ href: string; title: string; body: string; illustration: ReactNode; Icon: LucideIcon }`
  (drops `icons: LucideIcon[]`, adds single `Icon`).

- [ ] **Step 1: Rewrite `ToolCard.tsx`**

Replace `packages/web/components/ToolCard.tsx` with:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function ToolCard({
  href,
  title,
  body,
  illustration,
  Icon,
}: {
  href: string;
  title: string;
  body: string;
  illustration: ReactNode;
  Icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="group block h-full rounded-[20px] border border-line bg-surface p-4 shadow-soft transition-colors hover:border-muted/40"
    >
      <div className="relative h-48 overflow-hidden rounded-2xl bg-[#eef0f3] p-4">
        {illustration}
      </div>
      <h2 className="mt-4 flex items-center gap-2 text-base font-semibold">
        <Icon size={18} strokeWidth={1.75} className="text-ink" aria-hidden />
        {title}
      </h2>
      <p className="mt-1.5 text-[13px] text-muted">{body}</p>
    </Link>
  );
}
```

Changes: `group` added, `w-80 flex-none snap-start` → `h-full`, the bottom
3-icon cluster removed, one `Icon` beside the title, body `text-sm` →
`text-[13px]`.

- [ ] **Step 2: Rewrite `page.tsx` (grid + single icons)**

Replace `packages/web/app/page.tsx` with:

```tsx
import { ToolCard } from "@/components/ToolCard";
import { SorterIllus, StudioIllus, TranscribeIllus, SliceIllus } from "@/components/tool-illustrations";
import { Images, UserRound, Mic, Scissors } from "lucide-react";

const TOOLS = [
  {
    href: "/sorter",
    title: "Rank Drive photos",
    body: "Scan a Google Drive folder and rank each photo for headshot fitness, best first.",
    illustration: <SorterIllus />,
    Icon: Images,
  },
  {
    href: "/studio",
    title: "Build a branded headshot",
    body: "Turn a Drive photo into a clean, on-brand headshot you can download in a click.",
    illustration: <StudioIllus />,
    Icon: UserRound,
  },
  {
    href: "/transcribe",
    title: "Transcribe to a Google Doc",
    body: "Upload a long recording and get a Doc with a summary and full timestamped transcript.",
    illustration: <TranscribeIllus />,
    Icon: Mic,
  },
  {
    href: "/slice",
    title: "Slice a deck into PDFs",
    body: "Convert a deck to PDF, split it by page ranges, speaker, or topic, and stamp each page.",
    illustration: <SliceIllus />,
    Icon: Scissors,
  },
];

export default function Home() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {TOOLS.map((t) => (
        <ToolCard key={t.href} href={t.href} title={t.title} body={t.body} illustration={t.illustration} Icon={t.Icon} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (no remaining `icons=` usages).

- [ ] **Step 4: Manual verify**

Run: `npm run dev`, open `http://localhost:3000`.
- All four cards visible at once, 2×2 on a wide window, single column when
  narrowed. No horizontal scrollbar.
- Each card shows one icon beside its title, no circular icon cluster, body
  text slightly smaller.

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/ToolCard.tsx packages/web/app/page.tsx
git commit -m "feat(web): home card grid, one title icon, smaller body"
```

---

### Task 5: Card hover animations

**Files:**
- Modify: `packages/web/components/tool-illustrations.tsx`
- Reference: `packages/web/app/globals.css` (only if a keyframe is needed)

**Interfaces:**
- Consumes: the `group` class on the `ToolCard` root (Task 4) so illustrations
  react to `group-hover`.

- [ ] **Step 1: Add hover behaviour to each illustration**

Replace `packages/web/components/tool-illustrations.tsx` with:

```tsx
export function SorterIllus() {
  // Hover: the #1 tile scales up, siblings dim — reads as ranked best-first.
  return (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-2 motion-safe:[.group:hover_&>div:not(:first-child)]:opacity-50">
      <div className="relative rounded-lg bg-[#e4e7ec] transition-transform duration-300 motion-safe:group-hover:scale-110">
        <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white shadow-soft">1</span>
      </div>
      <div className="rounded-lg bg-[#d7dbe1] transition-opacity duration-300" />
      <div className="rounded-lg bg-[#e4e7ec] transition-opacity duration-300" />
      <div className="rounded-lg bg-[#e4e7ec] transition-opacity duration-300" />
      <div className="rounded-lg bg-[#d7dbe1] transition-opacity duration-300" />
      <div className="rounded-lg bg-[#e4e7ec] transition-opacity duration-300" />
    </div>
  );
}

export function StudioIllus() {
  // Hover: brand bar grows to full width, accent frame draws around the avatar.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5">
      <div className="grid h-24 w-24 place-items-center rounded-xl bg-[#e4e7ec] ring-0 ring-accent transition-all duration-300 motion-safe:group-hover:ring-2">
        <div className="h-9 w-9 rounded-full bg-[#d7dbe1]" />
      </div>
      <div className="h-2.5 w-16 rounded-full bg-gradient-to-r from-accent to-[#7aa0ff] opacity-90 transition-all duration-300 motion-safe:group-hover:w-28" />
    </div>
  );
}

export function TranscribeIllus() {
  const bars = [22, 40, 16, 52, 30, 46, 20, 36, 26, 48, 18];
  // Hover: bars pulse like an equalizer, text lines wipe in left to right.
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end gap-1.5" style={{ height: 56 }}>
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-1.5 rounded-full bg-[#e4e7ec] motion-safe:group-hover:animate-[eq_0.7s_ease-in-out_infinite]"
            style={{ height: h, animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="h-2 rounded-full bg-[#e4e7ec] transition-[width] duration-500 motion-safe:[.group:hover_&]:w-[92%]" style={{ width: "0%" }} />
        <div className="h-2 rounded-full bg-[#e4e7ec] transition-[width] delay-100 duration-500 motion-safe:[.group:hover_&]:w-[76%]" style={{ width: "0%" }} />
      </div>
    </div>
  );
}

export function SliceIllus() {
  const splits = ["40%", "32%", "52%"];
  // Hover: panels nudge apart, cut-lines settle in.
  return (
    <div className="flex h-full items-center gap-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`relative h-[104px] flex-1 overflow-hidden rounded-lg border border-[#e4e7ec] bg-surface transition-transform duration-300 ${
            i === 0 ? "motion-safe:group-hover:-translate-x-1" : i === 2 ? "motion-safe:group-hover:translate-x-1" : ""
          }`}
        >
          {i === 0 && (
            <span className="absolute right-1.5 top-1.5 rounded-full border border-[#e4e7ec] bg-surface px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-muted">
              confidential
            </span>
          )}
          <span className="absolute inset-x-0 border-t-2 border-dashed border-[#d7dbe1] transition-all duration-300 motion-safe:group-hover:border-accent" style={{ top: splits[i] }} />
          {i === 1 && <span className="absolute inset-x-0 border-t-2 border-dashed border-[#d7dbe1] transition-all duration-300 motion-safe:group-hover:border-accent" style={{ top: "64%" }} />}
        </div>
      ))}
    </div>
  );
}
```

Note the transcribe text lines start at `width: 0%` and grow on hover; the
inline `style={{ width: "0%" }}` is the rest state and the `[.group:hover_&]:w-[...]`
arbitrary variant is the hovered state.

- [ ] **Step 2: Add the equalizer keyframe**

In `packages/web/app/globals.css`, add:

```css
@keyframes eq {
  0%, 100% { transform: scaleY(0.7); }
  50% { transform: scaleY(1.25); }
}
```

(Bars use `transform-origin: bottom` implicitly via `items-end`; if the pulse
grows upward oddly, add `transform-origin: bottom` to the bar span class.)

- [ ] **Step 3: Verify arbitrary-variant compilation**

Run: `npm run build`
Expected: build succeeds. If Tailwind fails to parse a `[.group:hover_&]`
arbitrary variant, fall back to a named keyframe class defined in
`globals.css` for that element instead. Confirm no build error mentions an
unrecognized class.

- [ ] **Step 4: Manual verify**

Run: `npm run dev`, open `http://localhost:3000`.
- Hover Sorter: #1 tile grows, others dim.
- Hover Studio: brand bar extends, avatar gets an accent ring.
- Hover Transcribe: bars pulse, two text lines fill in.
- Hover Slice: outer panels part, cut-lines turn accent.
- Enable OS reduced-motion → hover produces no animation (or only instant
  static state), nothing pulses.

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/tool-illustrations.tsx packages/web/app/globals.css
git commit -m "feat(web): card hover animations hinting each tool"
```

---

## Self-review notes

- **Spec coverage:** nav latency (T2), configurable order store (T1) + live nav
  (T2) + settings edit UI (T3), home grid (T4), one title icon + smaller body
  (T4), remove circular cluster (T4), hover animations (T5). All covered.
- **Type consistency:** `NavLink`, `readNavOrder`, `writeNavOrder`,
  `NAV_ORDER_EVENT`, `orderTools`, `parseNavOrder` used identically across
  T1→T3. `ToolCard` `Icon` prop (T4) matches `page.tsx` usage (T4).
- **Anti-vibecode:** reuses existing tokens; accent only for meaning (rank
  badge, hovered cut-lines, avatar ring); sentence-case labels; no em dashes.
- **Risk flagged in-plan:** Tailwind arbitrary `group-hover` variants (T5 Step 3)
  have a named-keyframe fallback if they don't compile.
