// packages/web/components/Nav.tsx
"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { useToolShell } from "@/components/tool-shell-context";
import { ALL, FAV } from "@/components/tool-store";

export function Nav() {
  const router = useRouter();
  const path = usePathname();
  const { state, activeGroup, setActiveGroup, query } = useToolShell();
  const searching = query.trim().length > 0;

  const pills = [
    { id: ALL, label: "Home" },
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
  }, [activeIdx, motionOK, pills.length, state.groups, state.groupLabels]);

  function pick(id: string) {
    setActiveGroup(id);
    if (path !== "/") router.push("/");
  }

  return (
    <header className="relative border-b border-line">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3">
        <Link
          href="/"
          aria-label="Home, show all tools"
          onClick={() => setActiveGroup(ALL)}
          className="flex shrink-0 items-center gap-2 text-sm font-semibold text-ink"
        >
          <svg viewBox="0 0 600 600" width={21} height={21} className="shrink-0" aria-hidden>
            {/* Bento home glyph, layout from Caleb's 1.svg; food marks in the
                hand-built icon style. tray + marks = currentColor (ink), compartments
                = surface, so it reads and inverts cleanly on a light or dark nav. */}
            <rect width="600" height="600" rx="75" fill="currentColor" />
            <rect x="60" y="60" width="202.83" height="480" rx="45" className="fill-surface" />
            <rect x="300" y="60" width="240" height="220.99" rx="45" className="fill-surface" />
            <rect x="300" y="318.57" width="240" height="221.43" rx="45" className="fill-surface" />
            {/* umeboshi in the rice */}
            <circle cx="161.4" cy="300" r="34" fill="currentColor" />
            {/* cherry tomato */}
            <circle cx="420" cy="170.5" r="30" fill="currentColor" />
            {/* tamago swirl (JS Archimedean spiral) */}
            <path
              d="M420 429.3 L420.5 429.4 L421 429.5 L421.4 429.9 L421.7 430.3 L422 430.8 L422.1 431.4 L422.1 432.1 L422 432.7 L421.7 433.4 L421.3 434.1 L420.7 434.7 L420 435.3 L419.2 435.7 L418.2 436 L417.1 436.2 L416 436.2 L414.8 436 L413.6 435.6 L412.5 435.1 L411.3 434.3 L410.3 433.3 L409.4 432.1 L408.6 430.8 L408 429.3 L407.6 427.7 L407.4 425.9 L407.5 424.1 L407.9 422.3 L408.5 420.5 L409.4 418.7 L410.6 417 L412 415.4 L413.7 414 L415.6 412.9 L417.7 411.9 L420 411.3 L422.4 410.9 L424.9 410.9 L427.5 411.3 L430 412 L432.5 413 L434.8 414.4 L437.1 416.2 L439.1 418.3 L440.8 420.7 L442.2 423.3 L443.3 426.2 L444 429.3 L444.3 432.5 L444.1 435.8 L443.6 439 L442.5 442.3 L441 445.4 L439.1 448.4 L436.7 451.1 L434 453.5 L430.9 455.6 L427.5 457.3 L423.9 458.5 L420 459.3 L416 459.5 L412 459.2 L407.9 458.4 L404 457 L400.2 455.1 L396.7 452.6 L393.4 449.7 L390.6 446.3 L388.1 442.5 L386.2 438.3 L384.8 433.9 L384 429.3 L383.8 424.5 L384.3 419.7 L385.4 414.9 L387.1 410.3 L389.5 405.8 L392.4 401.7 L396 397.9 L400 394.6 L404.5 391.9 L409.4 389.7 L414.6 388.1 L420 387.3 L425.5 387.1 L431.1 387.8 L436.6 389.1 L442 391.2 L447.1 394 L451.8 397.5 L456.1 401.6 L459.8 406.3 L463 411.5 L465.4 417.1 L467.1 423.1 L468 429.3 L468.1 435.6 L467.3 442 L465.7 448.2 L463.3 454.3 L460.1 460 L456.1 465.3 L451.4 470.1 L446 474.3 L440.1 477.8 L433.7 480.5 L427 482.3 L420 483.3 L412.9 483.3 L405.8 482.4 L398.8 480.6 L392 477.8 L385.6 474.1 L379.7 469.6 L374.4 464.3 L369.8 458.3 L366 451.7 L363 444.6 L361 437.1 L360 429.3"
              fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
          <span className="hidden sm:inline">Bento</span>
        </Link>

        <nav className="relative flex flex-1 items-center gap-1 overflow-x-auto">
          <span
            ref={thumbRef}
            aria-hidden
            className={`nav-thumb pointer-events-none absolute left-0 top-0 z-0 rounded-lg bg-ink transition-opacity ${searching ? "opacity-40" : ""}`}
          />
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
