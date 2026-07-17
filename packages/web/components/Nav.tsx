// packages/web/components/Nav.tsx
"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Settings } from "lucide-react";
import { useToolShell } from "@/components/tool-shell-context";
import { ALL, FAV } from "@/components/tool-store";

// window.navigation isn't in lib.dom yet; declare the slice we use.
interface NavigationApi extends EventTarget {
  canGoBack: boolean;
  canGoForward: boolean;
}
declare global {
  interface Window {
    navigation?: NavigationApi;
  }
}

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
  const [canBack, setCanBack] = useState(true);
  const [canForward, setCanForward] = useState(true);

  useEffect(() => {
    setMotionOK(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // App version for the wordmark tooltip; null outside the desktop shell.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/version")
      .then((r) => r.json())
      .then((d) => setVersion(typeof d?.version === "string" ? d.version : null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const nav = window.navigation;
    if (!nav) return;
    const sync = () => {
      setCanBack(nav.canGoBack);
      setCanForward(nav.canGoForward);
    };
    sync();
    nav.addEventListener("currententrychange", sync);
    return () => nav.removeEventListener("currententrychange", sync);
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
      <div className="mx-auto flex max-w-5xl items-center gap-1.5 px-3 py-1 sm:gap-3 sm:px-6 sm:py-3">
        <Link
          href="/"
          aria-label="Home, show all tools"
          onClick={() => setActiveGroup(ALL)}
          className="flex shrink-0 items-center gap-2 text-sm font-semibold text-ink"
          data-tip={version ? `Version ${version}` : undefined}
        >
          <svg viewBox="0 0 600 600" className="h-[18px] w-[18px] shrink-0 sm:h-[21px] sm:w-[21px]" aria-hidden>
            {/* Bento home glyph, layout from Caleb's 1.svg with fatter gaps and
                rounder corners. tray = currentColor (ink), compartments = surface,
                so it reads and inverts cleanly on a light or dark nav.
                Regenerate/tune via scripts/gen-home-glyph.mjs. */}
            <rect width="600" height="600" rx="96" fill="currentColor" />
            <rect x="78" y="78" width="150" height="444" rx="50" className="fill-surface" />
            <rect x="314" y="78" width="208" height="179" rx="50" className="fill-surface" />
            <rect x="314" y="343" width="208" height="179" rx="50" className="fill-surface" />
          </svg>
          <span className="hidden sm:inline">Bento</span>
        </Link>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Go back"
            aria-disabled={!canBack}
            onClick={() => {
              if (canBack) history.back();
            }}
            className={`flex min-h-9 min-w-9 items-center justify-center rounded-lg px-1.5 py-1.5 text-muted hover:text-ink sm:min-h-[44px] sm:min-w-[44px] sm:px-2 sm:py-2 ${
              canBack ? "" : "cursor-default opacity-40"
            }`}
          >
            <ArrowLeft size={18} strokeWidth={1.75} className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Go forward"
            aria-disabled={!canForward}
            onClick={() => {
              if (canForward) history.forward();
            }}
            className={`flex min-h-9 min-w-9 items-center justify-center rounded-lg px-1.5 py-1.5 text-muted hover:text-ink sm:min-h-[44px] sm:min-w-[44px] sm:px-2 sm:py-2 ${
              canForward ? "" : "cursor-default opacity-40"
            }`}
          >
            <ArrowRight size={18} strokeWidth={1.75} className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => window.location.reload()}
            className="flex min-h-9 min-w-9 items-center justify-center rounded-lg px-1.5 py-1.5 text-muted hover:text-ink sm:min-h-[44px] sm:min-w-[44px] sm:px-2 sm:py-2"
          >
            <RotateCw size={18} strokeWidth={1.75} className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
          </button>
        </div>

        <nav className="relative flex flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain">
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
                className={`relative z-10 inline-flex min-h-9 items-center whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] transition-colors sm:min-h-[44px] sm:px-3 sm:py-2 sm:text-sm ${
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
          className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg px-1.5 py-1.5 text-muted hover:text-ink sm:min-h-[44px] sm:min-w-[44px] sm:px-2 sm:py-2"
        >
          <Settings size={18} strokeWidth={1.75} className="spin-hover h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
        </Link>
      </div>
    </header>
  );
}
