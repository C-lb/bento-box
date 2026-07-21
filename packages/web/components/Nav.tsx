// packages/web/components/Nav.tsx
"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Settings, Star } from "lucide-react";
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
  // Soft refresh: re-render server components in place. A full location.reload()
  // tears the WebView down to a blank frame first (the "black screen" on iOS).
  const [refreshing, startRefresh] = useTransition();
  // Spin the cog from tap until the settings page actually renders.
  const [settingsLoading, setSettingsLoading] = useState(false);
  useEffect(() => {
    if (path.startsWith("/settings")) setSettingsLoading(false);
  }, [path]);

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
          className="hidden shrink-0 items-center gap-2 text-sm font-semibold text-ink sm:flex"
          data-tip={version ? `Version ${version}` : undefined}
>
          <svg viewBox="0 0 600 600" className="h-[18px] w-[18px] shrink-0 sm:h-[21px] sm:w-[21px]" aria-hidden>
            {/* Bento Box home glyph, layout from Caleb's 1.svg with fatter gaps and
                rounder corners. tray = currentColor (ink), compartments = surface,
                so it reads and inverts cleanly on a light or dark nav.
                Regenerate/tune via scripts/gen-home-glyph.mjs. */}
            <rect width="600" height="600" rx="96" fill="currentColor" />
            <rect x="78" y="78" width="150" height="444" rx="50" className="fill-surface" />
            <rect x="314" y="78" width="208" height="179" rx="50" className="fill-surface" />
            <rect x="314" y="343" width="208" height="179" rx="50" className="fill-surface" />
          </svg>
          <span className="hidden sm:inline">Bento Box</span>
        </Link>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Go back"
            aria-disabled={!canBack}
            onClick={() => {
              if (canBack) history.back();
            }}
            className={`flex min-h-7 min-w-7 items-center justify-center rounded-lg px-1 py-1 text-muted hover:text-ink sm:min-h-[44px] sm:min-w-[44px] sm:px-2 sm:py-2 ${
              canBack ? "" : "cursor-default opacity-40"
            }`}
          >
            <ArrowLeft size={18} strokeWidth={1.75} className="h-3.5 w-3.5 sm:h-[18px] sm:w-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Go forward"
            aria-disabled={!canForward}
            onClick={() => {
              if (canForward) history.forward();
            }}
            className={`flex min-h-7 min-w-7 items-center justify-center rounded-lg px-1 py-1 text-muted hover:text-ink sm:min-h-[44px] sm:min-w-[44px] sm:px-2 sm:py-2 ${
              canForward ? "" : "cursor-default opacity-40"
            }`}
          >
            <ArrowRight size={18} strokeWidth={1.75} className="h-3.5 w-3.5 sm:h-[18px] sm:w-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Refresh"
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
            className="flex min-h-7 min-w-7 items-center justify-center rounded-lg px-1 py-1 text-muted hover:text-ink sm:min-h-[44px] sm:min-w-[44px] sm:px-2 sm:py-2"
          >
            <RotateCw
              size={18}
              strokeWidth={1.75}
              className={`h-3.5 w-3.5 sm:h-[18px] sm:w-[18px] ${refreshing ? "animate-spin" : ""}`}
              aria-hidden
            />
          </button>
        </div>

        <div className="relative min-w-0 flex-1">
          <nav className="relative flex items-center gap-1 overflow-x-auto overscroll-x-contain">
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
                  aria-label={p.id === FAV ? "Favourites" : undefined}
                  className={`relative z-10 inline-flex min-h-9 items-center whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] transition-colors sm:min-h-[44px] sm:px-3 sm:py-2 sm:text-sm ${
                    active ? "text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {p.id === FAV ? (
                    <>
                      <Star
                        size={16}
                        strokeWidth={1.75}
                        className={`h-4 w-4 sm:hidden ${active ? "fill-current" : ""}`}
                        aria-hidden
                      />
                      <span className="hidden sm:inline">{p.label}</span>
                    </>
                  ) : (
                    p.label
                  )}
                </button>
              );
            })}
          </nav>
          {/* Right-edge fade: hints that the pill row scrolls sideways (mobile only). */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-canvas to-transparent sm:hidden"
          />
        </div>

        <Link
          href="/settings"
          aria-label="Settings"
          aria-current={path.startsWith("/settings") ? "page" : undefined}
          onClick={() => {
            if (!path.startsWith("/settings")) setSettingsLoading(true);
          }}
          className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg px-1.5 py-1.5 text-muted hover:text-ink sm:min-h-[44px] sm:min-w-[44px] sm:px-2 sm:py-2"
        >
          <Settings
            size={18}
            strokeWidth={1.75}
            className={`spin-hover h-4 w-4 sm:h-[18px] sm:w-[18px] ${settingsLoading ? "animate-spin" : ""}`}
            aria-hidden
          />
        </Link>
      </div>
    </header>
  );
}
