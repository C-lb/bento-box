// packages/web/components/Nav.tsx
"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Home, Settings } from "lucide-react";
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
          <Home size={18} strokeWidth={1.75} aria-hidden />
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
