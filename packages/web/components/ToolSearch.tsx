"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Search, SlidersHorizontal } from "lucide-react";
import { useToolShell } from "@/components/tool-shell-context";
import { TOOL_SORT_OPTIONS } from "@/components/tool-store";

export function ToolSearch() {
  const { query, setQuery, sort, setSort } = useToolShell();
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sortOpen) return;
    function onDown(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSortOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sortOpen]);

  return (
    // Sticks at the safe-area inset (not 0) so when the nav scrolls away the bar
    // pins just below the Dynamic Island / notch instead of under it. Using the
    // inset on `top` (not padding) means no dead gap in the resting position,
    // where the bar already sits below the safe-area-padded nav. The island zone
    // above it is covered by SafeAreaCap so cards never peek out beside it.
    <div
      className="sticky z-30 border-b border-line bg-canvas/90 backdrop-blur"
      style={{ top: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-0.5 sm:px-6 sm:py-2">
        <Search size={16} strokeWidth={1.75} className="h-3.5 w-3.5 text-muted sm:h-4 sm:w-4" aria-hidden />
        <input
          id="tool-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools by name or tag"
          aria-label="Search tools"
          className="min-h-9 w-full bg-transparent py-1 text-[13px] outline-none placeholder:text-muted sm:min-h-0 sm:text-sm"
        />
        <div ref={sortRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Sort tools"
            aria-haspopup="menu"
            aria-expanded={sortOpen}
            onClick={() => setSortOpen((v) => !v)}
            className={`flex min-h-9 min-w-9 items-center justify-center rounded-lg hover:text-ink sm:min-h-[36px] sm:min-w-[36px] ${
              sort !== "default" ? "text-ink" : "text-muted"
            }`}
          >
            <SlidersHorizontal size={16} strokeWidth={1.75} className="h-4 w-4" aria-hidden />
          </button>
          {sortOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-line bg-surface p-2 text-sm shadow-soft"
            >
              <p className="px-2 pb-1 pt-0.5 text-[11px] text-muted">Sort cards</p>
              {TOOL_SORT_OPTIONS.map((o) => {
                const active = o.id === sort;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      setSort(o.id);
                      setSortOpen(false);
                    }}
                    className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[#eef0f3] ${
                      active ? "text-ink" : "text-muted"
                    }`}
                  >
                    {o.label}
                    {active && <Check size={14} strokeWidth={2} aria-hidden />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
