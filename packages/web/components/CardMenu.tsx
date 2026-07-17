"use client";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Plus, Star } from "lucide-react";
import type { Tool } from "@/components/tools";
import { useToolShell } from "@/components/tool-shell-context";
import { effectiveGroups } from "@/components/tool-store";

export function CardMenu({ tool }: { tool: Tool }) {
  const shell = useToolShell();
  const [open, setOpen] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const [burst, setBurst] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isFav = shell.state.favourites.includes(tool.id);
  const inGroups = new Set(effectiveGroups(shell.state, tool));

  function addGroup() {
    const label = newGroup.trim();
    if (!label) return;
    shell.createGroup(label, tool.id);
    setNewGroup("");
  }

  return (
    <div
      ref={ref}
      className={`absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 sm:top-2 sm:translate-y-0 ${
        open ? "z-50" : "z-20"
      }`}
    >
      {/* Mobile: one-tap favourite star, no bubble. Desktop keeps it inside the menu. */}
      <button
        type="button"
        aria-label={isFav ? "Remove from favourites" : "Add to favourites"}
        aria-pressed={isFav}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isFav) setBurst((n) => n + 1);
          shell.toggleFavourite(tool.id);
        }}
        className="flex min-h-9 min-w-9 items-center justify-center rounded-full text-muted hover:text-ink sm:hidden"
      >
        <span key={burst} className="relative inline-flex">
          <Star
            size={18}
            strokeWidth={1.75}
            className={`${isFav ? "fill-current text-ink" : ""} ${burst > 0 ? "fav-pop" : ""}`}
            aria-hidden
          />
          {burst > 0 && (
            <span className="fav-spark pointer-events-none" aria-hidden>
              {Array.from({ length: 6 }).map((_, i) => {
                const a = (i / 6) * Math.PI * 2;
                return (
                  <i
                    key={i}
                    style={{ "--tx": `${Math.cos(a) * 13}px`, "--ty": `${Math.sin(a) * 13}px` } as CSSProperties}
                  />
                );
              })}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        aria-label="Card options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="dots-trigger flex min-h-9 min-w-9 items-center justify-center rounded-full text-muted hover:text-ink sm:min-h-[44px] sm:min-w-[44px] sm:border sm:border-line sm:bg-surface sm:p-1.5 sm:shadow-soft"
      >
        {/* Mobile: plain plus. Desktop: dots in left-to-right DOM order so the hover wave lifts them in sequence. */}
        <Plus size={18} strokeWidth={1.75} className="sm:hidden" aria-hidden />
        <svg viewBox="0 0 24 24" width={16} height={16} className="dots-wave hidden sm:block" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-line bg-surface p-2 text-sm shadow-soft"
        >
          <button
            type="button"
            onClick={() => {
              if (!isFav) setBurst((n) => n + 1); // celebrate only on add
              shell.toggleFavourite(tool.id);
            }}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-ink hover:bg-[#eef0f3]"
          >
            <span key={burst} className="relative inline-flex text-ink">
              <Star
                size={16}
                strokeWidth={1.75}
                className={`${isFav ? "fill-current text-ink" : "text-muted"} ${burst > 0 ? "fav-pop" : ""}`}
                aria-hidden
              />
              {burst > 0 && (
                <span className="fav-spark pointer-events-none" aria-hidden>
                  {Array.from({ length: 6 }).map((_, i) => {
                    const a = (i / 6) * Math.PI * 2;
                    return (
                      <i
                        key={i}
                        style={{ "--tx": `${Math.cos(a) * 13}px`, "--ty": `${Math.sin(a) * 13}px` } as CSSProperties}
                      />
                    );
                  })}
                </span>
              )}
            </span>
            {isFav ? "Remove from favourites" : "Add to favourites"}
          </button>

          <div className="my-1 h-px bg-line" />

          <div className="max-h-48 overflow-y-auto">
            {shell.state.groups.map((gid) => (
              <label key={gid} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#eef0f3]">
                <input
                  type="checkbox"
                  checked={inGroups.has(gid)}
                  onChange={(e) => shell.setMembership(tool, gid, e.target.checked)}
                />
                <span className="text-ink">{shell.state.groupLabels[gid] ?? gid}</span>
              </label>
            ))}
          </div>

          <div className="my-1 h-px bg-line" />

          <div className="flex items-center gap-1 px-1">
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addGroup();
              }}
              placeholder="New group"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm outline-none"
            />
            <button
              type="button"
              onClick={addGroup}
              className="self-stretch rounded-lg border border-line px-3 py-1 text-muted hover:text-ink sm:min-h-[44px]"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
