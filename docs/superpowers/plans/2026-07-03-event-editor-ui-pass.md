# event-editor UI pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the event-editor web chrome and home: an "ee" favicon, a dark nav pill that slides between tabs and bursts stars on land, an illustrated home-card carousel, batch folded into the studio page, and normalized icon strokes.

**Architecture:** Five independent presentational changes in `packages/web`. The nav pill is a single absolutely-positioned "thumb" behind the links whose position is driven by a `useLayoutEffect` keyed on `usePathname()`; a CSS transition animates the slide and a `transitionend` handler fires a Web Animations star burst. The home cards become a data-driven horizontal scroll-snap rail. Batch becomes a client `StudioTabs` Single/Batch toggle and its old route redirects.

**Tech Stack:** Next.js App Router (client components), TypeScript, Tailwind (house tokens), lucide-react, Vitest. No new dependencies.

## Global Constraints

- Test runner is Vitest; web tests live in `packages/web/test/*.test.ts`; the `@` alias resolves to the `packages/web` root. Run: `npm -w @event-editor/web run test`.
- Typecheck via `cd packages/web && npx tsc --noEmit` has **5 PRE-EXISTING errors** in `test/docs.test.ts` and `test/canva-oauth.test.ts`. Success = no NEW errors from the task's own files, not zero total.
- Structural changes (new files, redirects, client boundaries) must pass `npm -w @event-editor/web run build`.
- No new dependencies. Icons are lucide-react only, standardized to `strokeWidth={1.75}`.
- No em dashes and no ALL-CAPS labels in any UI copy (house rule). Eyebrows and stamps are sentence case.
- Reuse house tokens/classes: accent `#3b6cf6`, ink `#1a1d23`, muted `#5f6b7a`, line `#e4e7ec`, `bg-raised`, `shadow-raisededge`, `shadow-soft`, `bg-surface`, `text-muted`. Illustration greys: fill `#eef0f3`, block `#e4e7ec`, darker block `#d7dbe1`.
- The nav motion must respect `prefers-reduced-motion` (snap, no burst) and must not animate or burst on first paint / hard load, only on client route changes.
- This is Caleb's repo: commit per task on `main`, push `main` at the end.

---

## File Structure

**Create:**
- `packages/web/app/icon.svg` — favicon (Next file convention).
- `packages/web/components/nav-anim.ts` — pure nav helpers (framework-free, unit-tested).
- `packages/web/components/tool-illustrations.tsx` — the four per-tool illustration components.
- `packages/web/app/studio/StudioTabs.tsx` — Single/Batch client toggle.
- `packages/web/test/nav-anim.test.ts` — unit tests for the nav helpers.

**Modify:**
- `packages/web/components/Nav.tsx` — dark pill + sliding thumb + star burst; drop the `/studio/batch` link.
- `packages/web/app/globals.css` — add the `.nav-thumb` transition rule.
- `packages/web/components/ToolCard.tsx` — rewrite to illustration + icon row + title + body.
- `packages/web/app/page.tsx` — remove heading; render the card carousel from a data array.
- `packages/web/app/studio/page.tsx` — render `StudioTabs` instead of `StudioClient`.
- `packages/web/app/studio/batch/page.tsx` — redirect to `/studio`.
- `packages/web/components/{StatusBadge,CopyButton,FileDrop,EventDetailsPanel}.tsx`, `packages/web/app/slice/SliceClient.tsx`, `packages/web/app/transcribe/TranscribeClient.tsx` — add `strokeWidth={1.75}` to lucide icons.

---

### Task 1: Favicon (ee monogram)

**Files:**
- Create: `packages/web/app/icon.svg`

**Interfaces:**
- Produces: a file-convention favicon at `/icon.svg`; no code imports it.

- [ ] **Step 1: Create the icon**

Create `packages/web/app/icon.svg` with exactly:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#1a1d23"/>
  <text x="32" y="34" text-anchor="middle" dominant-baseline="central" font-family="'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="34" font-weight="600" letter-spacing="-2" fill="#ffffff">ee</text>
</svg>
```

- [ ] **Step 2: Verify the build picks it up**

Run: `npm -w @event-editor/web run build`
Expected: build succeeds. Next auto-detects `app/icon.svg` and injects `<link rel="icon">`. (Manual: after `npm -w @event-editor/web run dev`, the tab shows the dark "ee" tile.)

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/icon.svg
git commit -m "feat(web): add ee monogram favicon"
```

---

### Task 2: Nav dark pill with sliding thumb and star burst

**Files:**
- Create: `packages/web/components/nav-anim.ts`
- Create: `packages/web/test/nav-anim.test.ts`
- Modify: `packages/web/components/Nav.tsx` (full rewrite)
- Modify: `packages/web/app/globals.css` (append one rule)

**Interfaces:**
- Produces:
  - `navShouldAnimate(prev: string | null, next: string): boolean`
  - `bestMatchIndex(hrefs: string[], path: string): number`
  - `Nav` component (unchanged export name).

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/nav-anim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { navShouldAnimate, bestMatchIndex } from "@/components/nav-anim";

const HREFS = ["/", "/sorter", "/transcribe", "/studio", "/slice", "/settings"];

describe("navShouldAnimate", () => {
  it("does not animate on first mount (prev null)", () => {
    expect(navShouldAnimate(null, "/")).toBe(false);
  });
  it("does not animate when the route is unchanged", () => {
    expect(navShouldAnimate("/", "/")).toBe(false);
  });
  it("animates when the route changes", () => {
    expect(navShouldAnimate("/", "/slice")).toBe(true);
  });
});

describe("bestMatchIndex", () => {
  it("matches home exactly", () => {
    expect(bestMatchIndex(HREFS, "/")).toBe(0);
  });
  it("matches a top-level route", () => {
    expect(bestMatchIndex(HREFS, "/slice")).toBe(4);
  });
  it("matches a nested path to its prefix (studio subpaths route to studio)", () => {
    expect(bestMatchIndex(HREFS, "/studio/batch")).toBe(3);
  });
  it("does not treat home as a prefix of everything", () => {
    expect(bestMatchIndex(HREFS, "/sorter")).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web run test -- nav-anim`
Expected: FAIL — `@/components/nav-anim` does not exist yet.

- [ ] **Step 3: Create the pure helpers**

Create `packages/web/components/nav-anim.ts`:

```ts
export function navShouldAnimate(prev: string | null, next: string): boolean {
  return prev !== null && prev !== next;
}

export function bestMatchIndex(hrefs: string[], path: string): number {
  let idx = 0;
  let best = -1;
  hrefs.forEach((href, i) => {
    const match = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
    if (match && href.length > best) {
      best = href.length;
      idx = i;
    }
  });
  return idx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web run test -- nav-anim`
Expected: PASS (7/7).

- [ ] **Step 5: Add the thumb transition rule to globals.css**

Append to `packages/web/app/globals.css`:

```css
.nav-thumb {
  transition: transform .52s cubic-bezier(.25, 1.12, .32, 1), width .52s cubic-bezier(.3, .8, .3, 1);
}
```

- [ ] **Step 6: Rewrite `packages/web/components/Nav.tsx`**

Replace the whole file with:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Home, Images, Mic, UserRound, Settings, Scissors, type LucideIcon } from "lucide-react";
import { navShouldAnimate, bestMatchIndex } from "@/components/nav-anim";

const LINKS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/sorter", label: "Photo sorter", Icon: Images },
  { href: "/transcribe", label: "Audio transcriber", Icon: Mic },
  { href: "/studio", label: "Headshot studio", Icon: UserRound },
  { href: "/slice", label: "Slide slicer", Icon: Scissors },
  { href: "/settings", label: "Settings", Icon: Settings },
];

const STAR = '<svg viewBox="0 0 24 24" fill="#1a1d23" width="100%" height="100%"><path d="M12 1.6l3.09 6.26 6.91.99-5 4.87 1.18 6.88L12 18.9l-6.18 3.25L7 15.72l-5-4.87 6.91-.99z"/></svg>';

export function Nav() {
  const path = usePathname();
  const activeIdx = bestMatchIndex(LINKS.map((l) => l.href), path);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const fxRef = useRef<HTMLSpanElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const prevPath = useRef<string | null>(null);
  const enabled = useRef(false);
  const [motionOK, setMotionOK] = useState(false);

  useEffect(() => {
    setMotionOK(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
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
  }, [path, activeIdx, motionOK]);

  useEffect(() => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "transform" && motionOK) burst();
    };
    thumb.addEventListener("transitionend", onEnd);
    return () => thumb.removeEventListener("transitionend", onEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionOK]);

  function burst() {
    const el = linkRefs.current[activeIdx];
    const fx = fxRef.current;
    const header = headerRef.current;
    if (!el || !fx || !header) return;
    const r = el.getBoundingClientRect();
    const h = header.getBoundingClientRect();
    const cx = r.left - h.left + r.width / 2;
    const cy = r.top - h.top + r.height / 2;
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("span");
      s.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;`;
      s.innerHTML = STAR;
      fx.appendChild(s);
      const ang = ((-90 + (i / 6) * 360) * Math.PI) / 180;
      const rad = 26 + (i % 3) * 10;
      const dx = Math.cos(ang) * rad;
      const dy = Math.sin(ang) * rad - 6;
      const rot = (i % 2 ? 1 : -1) * (120 + i * 20);
      s.animate(
        [
          { transform: "translate(0,0) scale(.2)", opacity: 1 },
          { transform: `translate(${dx * 0.6}px,${dy * 0.6}px) scale(1)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${dx}px,${dy}px) scale(.4) rotate(${rot}deg)`, opacity: 0 },
        ],
        { duration: 620, easing: "cubic-bezier(.25,.7,.3,1)" }
      ).onfinish = () => s.remove();
    }
  }

  return (
    <header ref={headerRef} className="relative border-b border-line">
      <span ref={fxRef} aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-visible" />
      <nav className="relative mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-6 py-3">
        <span ref={thumbRef} aria-hidden className="nav-thumb pointer-events-none absolute left-0 top-0 z-0 rounded-lg bg-ink" />
        {LINKS.map(({ href, label, Icon }, i) => {
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

- [ ] **Step 7: Typecheck + build**

Run: `cd packages/web && npx tsc --noEmit`
Expected: only the 5 pre-existing errors, none from `components/Nav.tsx` or `components/nav-anim.ts`.
Run: `npm -w @event-editor/web run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/web/components/nav-anim.ts packages/web/components/Nav.tsx packages/web/app/globals.css packages/web/test/nav-anim.test.ts
git commit -m "feat(web): nav dark pill with sliding thumb and star burst"
```

- [ ] **Step 9: Manual note**

Verified in the final manual pass: clicking between nav items slides the dark pill and bursts stars on land; a hard refresh places the pill with no animation and no stars; `/studio/batch` is gone from the nav; reduced-motion snaps with no burst.

---

### Task 3: Home heading removal + illustrated card carousel

**Files:**
- Create: `packages/web/components/tool-illustrations.tsx`
- Modify: `packages/web/components/ToolCard.tsx` (full rewrite)
- Modify: `packages/web/app/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: lucide icons; the illustration components below.
- Produces:
  - `SorterIllus`, `StudioIllus`, `TranscribeIllus`, `SliceIllus` (no props).
  - `ToolCard({ href, title, body, illustration, icons })` where `illustration: ReactNode` and `icons: LucideIcon[]`.

- [ ] **Step 1: Create the illustrations**

Create `packages/web/components/tool-illustrations.tsx`:

```tsx
export function SorterIllus() {
  return (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-2">
      <div className="relative rounded-lg bg-[#e4e7ec]">
        <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white shadow-soft">1</span>
      </div>
      <div className="rounded-lg bg-[#d7dbe1]" />
      <div className="rounded-lg bg-[#e4e7ec]" />
      <div className="rounded-lg bg-[#e4e7ec]" />
      <div className="rounded-lg bg-[#d7dbe1]" />
      <div className="rounded-lg bg-[#e4e7ec]" />
    </div>
  );
}

export function StudioIllus() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5">
      <div className="grid h-24 w-24 place-items-center rounded-xl bg-[#e4e7ec]">
        <div className="h-9 w-9 rounded-full bg-[#d7dbe1]" />
      </div>
      <div className="h-2.5 w-28 rounded-full bg-gradient-to-r from-accent to-[#7aa0ff] opacity-90" />
    </div>
  );
}

export function TranscribeIllus() {
  const bars = [22, 40, 16, 52, 30, 46, 20, 36, 26, 48, 18];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end gap-1.5" style={{ height: 56 }}>
        {bars.map((h, i) => (
          <span key={i} className="w-1.5 rounded-full bg-[#e4e7ec]" style={{ height: h }} />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="h-2 rounded-full bg-[#e4e7ec]" style={{ width: "92%" }} />
        <div className="h-2 rounded-full bg-[#e4e7ec]" style={{ width: "76%" }} />
      </div>
    </div>
  );
}

export function SliceIllus() {
  const splits = ["40%", "32%", "52%"];
  return (
    <div className="flex h-full items-center gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="relative h-[104px] flex-1 overflow-hidden rounded-lg border border-[#e4e7ec] bg-surface">
          {i === 0 && (
            <span className="absolute right-1.5 top-1.5 rounded-full border border-[#e4e7ec] bg-surface px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-muted">
              confidential
            </span>
          )}
          <span className="absolute inset-x-0 border-t-2 border-dashed border-[#d7dbe1]" style={{ top: splits[i] }} />
          {i === 1 && <span className="absolute inset-x-0 border-t-2 border-dashed border-[#d7dbe1]" style={{ top: "64%" }} />}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `packages/web/components/ToolCard.tsx`**

Replace the whole file with:

```tsx
import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function ToolCard({
  href,
  title,
  body,
  illustration,
  icons,
}: {
  href: string;
  title: string;
  body: string;
  illustration: ReactNode;
  icons: LucideIcon[];
}) {
  return (
    <Link
      href={href}
      className="block w-80 flex-none snap-start rounded-[20px] border border-line bg-surface p-4 shadow-soft transition-colors hover:border-muted/40"
    >
      <div className="relative h-48 overflow-hidden rounded-2xl bg-[#eef0f3] p-4">
        {illustration}
        <div className="absolute bottom-3 left-3 flex gap-2">
          {icons.map((Icon, i) => (
            <span key={i} className="grid h-9 w-9 place-items-center rounded-full bg-surface shadow-soft">
              <Icon size={18} strokeWidth={1.75} className="text-ink" aria-hidden />
            </span>
          ))}
        </div>
      </div>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm text-muted">{body}</p>
    </Link>
  );
}
```

- [ ] **Step 3: Rewrite `packages/web/app/page.tsx`**

Replace the whole file with:

```tsx
import { ToolCard } from "@/components/ToolCard";
import { SorterIllus, StudioIllus, TranscribeIllus, SliceIllus } from "@/components/tool-illustrations";
import { Images, Star, ArrowDownUp, UserRound, Crop, Download, Mic, AudioLines, FileText, Layers, Scissors, Shield } from "lucide-react";

const TOOLS = [
  {
    href: "/sorter",
    title: "Rank Drive photos",
    body: "Scan a Google Drive folder and rank each photo for headshot fitness, best first.",
    illustration: <SorterIllus />,
    icons: [Images, Star, ArrowDownUp],
  },
  {
    href: "/studio",
    title: "Build a branded headshot",
    body: "Turn a Drive photo into a clean, on-brand headshot you can download in a click.",
    illustration: <StudioIllus />,
    icons: [UserRound, Crop, Download],
  },
  {
    href: "/transcribe",
    title: "Transcribe to a Google Doc",
    body: "Upload a long recording and get a Doc with a summary and full timestamped transcript.",
    illustration: <TranscribeIllus />,
    icons: [Mic, AudioLines, FileText],
  },
  {
    href: "/slice",
    title: "Slice a deck into PDFs",
    body: "Convert a deck to PDF, split it by page ranges, speaker, or topic, and stamp each page.",
    illustration: <SliceIllus />,
    icons: [Layers, Scissors, Shield],
  },
];

export default function Home() {
  return (
    <div className="-mx-6 overflow-x-auto px-6 [scrollbar-width:thin]">
      <div className="flex snap-x snap-mandatory gap-5 pb-2">
        {TOOLS.map((t) => (
          <ToolCard key={t.href} href={t.href} title={t.title} body={t.body} illustration={t.illustration} icons={t.icons} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `cd packages/web && npx tsc --noEmit`
Expected: only the 5 pre-existing errors; none from `app/page.tsx`, `components/ToolCard.tsx`, or `components/tool-illustrations.tsx`. (This confirms every lucide name imported in `page.tsx` exists.)
Run: `npm -w @event-editor/web run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/tool-illustrations.tsx packages/web/components/ToolCard.tsx packages/web/app/page.tsx
git commit -m "feat(web): illustrated tool-card carousel, remove home heading"
```

---

### Task 4: Fold Batch into Headshot studio

**Files:**
- Create: `packages/web/app/studio/StudioTabs.tsx`
- Modify: `packages/web/app/studio/page.tsx`
- Modify: `packages/web/app/studio/batch/page.tsx`

**Interfaces:**
- Consumes: `StudioClient` (`./StudioClient`, no props), `StudioBatchClient` (`./batch/StudioBatchClient`, no props).
- Produces: `StudioTabs` (no props) client component.

- [ ] **Step 1: Create `packages/web/app/studio/StudioTabs.tsx`**

```tsx
"use client";
import { useState } from "react";
import { StudioClient } from "./StudioClient";
import { StudioBatchClient } from "./batch/StudioBatchClient";

export function StudioTabs() {
  const [tab, setTab] = useState<"single" | "batch">("single");
  return (
    <div>
      <div className="mt-3 inline-flex rounded-lg border border-line p-1">
        <button
          type="button"
          onClick={() => setTab("single")}
          className={`rounded-md px-3 py-1.5 text-sm ${tab === "single" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}
        >
          Single
        </button>
        <button
          type="button"
          onClick={() => setTab("batch")}
          className={`rounded-md px-3 py-1.5 text-sm ${tab === "batch" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}
        >
          Batch
        </button>
      </div>
      <div className="mt-6">{tab === "single" ? <StudioClient /> : <StudioBatchClient />}</div>
    </div>
  );
}
```

- [ ] **Step 2: Point the studio page at `StudioTabs`**

Rewrite `packages/web/app/studio/page.tsx`:

```tsx
import { getConnections } from "@event-editor/core/settings";
import { StudioTabs } from "./StudioTabs";

export const dynamic = "force-dynamic";

export default function StudioPage() {
  const google = getConnections().find((c) => c.id === "google");
  return (
    <div>
      <p className="eyebrow">Headshot studio</p>
      <h1 className="mt-1 text-2xl font-semibold">Build branded headshots</h1>
      {!google?.configured ? (
        <div className="card mt-8">
          <p className="text-muted">Google credentials are not set in your environment yet.</p>
          <p className="mt-2 text-muted">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart.</p>
        </div>
      ) : (
        <StudioTabs />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Redirect the old batch route**

Rewrite `packages/web/app/studio/batch/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function BatchPage() {
  redirect("/studio");
}
```

(`StudioBatchClient.tsx` in the same folder is untouched; it is now imported by `StudioTabs`.)

- [ ] **Step 4: Typecheck + build**

Run: `cd packages/web && npx tsc --noEmit`
Expected: only the 5 pre-existing errors; none from the three studio files.
Run: `npm -w @event-editor/web run build`
Expected: build succeeds, `/studio` and `/studio/batch` both compile (the latter as a redirect).

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/studio/StudioTabs.tsx packages/web/app/studio/page.tsx packages/web/app/studio/batch/page.tsx
git commit -m "feat(web): fold batch into studio via Single/Batch toggle"
```

- [ ] **Step 6: Manual note**

Verified in the final manual pass: `/studio` shows the Single/Batch toggle and switches flows; visiting `/studio/batch` redirects to `/studio`.

---

### Task 5: Normalize icon strokes

Add `strokeWidth={1.75}` to every lucide icon in the remaining visible clusters (Nav and the cards are already done in Tasks 2 and 3). This is a uniform mechanical prop-add; sizes/classes stay as they are.

**Files:**
- Modify: `packages/web/components/StatusBadge.tsx`
- Modify: `packages/web/components/CopyButton.tsx`
- Modify: `packages/web/components/FileDrop.tsx`
- Modify: `packages/web/components/EventDetailsPanel.tsx`
- Modify: `packages/web/app/slice/SliceClient.tsx`
- Modify: `packages/web/app/transcribe/TranscribeClient.tsx`

**Interfaces:**
- No API changes; presentational only.

- [ ] **Step 1: Apply the prop**

In each file above, for every rendered lucide icon element that does not already set `strokeWidth`, add `strokeWidth={1.75}`. Leave `size=`/`className` (e.g. `w-4 h-4`, `size={16}`) exactly as they are.

Two concrete examples (apply the same edit to every lucide icon in the six files):
- `StatusBadge.tsx` — an icon like `<Loader2 size={16} className="animate-spin" />` becomes `<Loader2 size={16} strokeWidth={1.75} className="animate-spin" />`.
- `CopyButton.tsx` — `<Check className="w-4 h-4" />` becomes `<Check className="w-4 h-4" strokeWidth={1.75} />`.

Do not add icons, change which icons are used, or alter any surrounding markup.

- [ ] **Step 2: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: only the 5 pre-existing errors; none from the six edited files (`strokeWidth` is a valid lucide prop, so this is type-safe).

- [ ] **Step 3: Build**

Run: `npm -w @event-editor/web run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/web/components/StatusBadge.tsx packages/web/components/CopyButton.tsx packages/web/components/FileDrop.tsx packages/web/components/EventDetailsPanel.tsx packages/web/app/slice/SliceClient.tsx packages/web/app/transcribe/TranscribeClient.tsx
git commit -m "style(web): normalize lucide icon stroke to 1.75 across tool UI"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: Manual note**

Verified in the final manual pass: icon weight reads consistently across nav, cards, and in-tool buttons.

---

## Self-Review

**Spec coverage:**
- Remove home heading → Task 3 Step 3. ✓
- Nav dark pill + FLIP slide + star burst + drop batch link + reduced-motion + no-first-paint-anim → Task 2. ✓
- Icon normalization (already-lucide, strokeWidth 1.75) → Task 5 (+ Nav in Task 2, cards in Task 3). ✓
- Batch fold as Single/Batch toggle + `/studio/batch` redirect → Task 4. ✓
- "ee" favicon (`app/icon.svg`, none existed) → Task 1. ✓
- Illustrated card carousel (per-tool illustration + icon row + title + body, scroll-snap) → Task 3. ✓
- Testing = typecheck + build + manual; the one genuinely pure unit (nav animate/prefix helpers) is unit-tested in Task 2. ✓

**Placeholder scan:** No TBD/TODO. Task 5 uses a uniform mechanical rule with two concrete examples (justified: a repetitive identical prop-add across many icons, not a logic change). Every other code step shows the full file or exact block. ✓

**Type consistency:** `navShouldAnimate`/`bestMatchIndex` defined in Task 2 Step 3, consumed by `Nav.tsx` (Step 6) and the test (Step 1) with identical signatures. `ToolCard({ href, title, body, illustration, icons })` defined in Task 3 Step 2, called with exactly those props in Step 3. Illustration component names (`SorterIllus`, `StudioIllus`, `TranscribeIllus`, `SliceIllus`) defined in Task 3 Step 1, imported in Step 3. `StudioTabs` defined in Task 4 Step 1, imported in Step 2. All lucide names in `page.tsx` are real lucide-react exports (verified by the Task 3 typecheck gate). ✓

**House-rule check:** dark pill uses `bg-ink`/`text-white` (neutral, not a second accent); accent appears only on the sorter `#1` rank badge and the studio brand strip (both meaning-carrying); no ALL-CAPS ("confidential" is lower case); no em dashes in any copy string; `.nav-thumb` transition is the approved tuned curve. ✓
