"use client";
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Star } from "lucide-react";
import type { Tool } from "@/components/tools";
import { useToolShell } from "@/components/tool-shell-context";
import { effectiveGroups } from "@/components/tool-store";

export function CardMenu({ tool }: { tool: Tool }) {
  const shell = useToolShell();
  const [open, setOpen] = useState(false);
  const [newGroup, setNewGroup] = useState("");
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
    <div ref={ref} className="absolute right-2 top-2 z-20">
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
        className="rounded-lg border border-line bg-surface p-1.5 text-muted shadow-soft hover:text-ink"
      >
        <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          onClick={(e) => e.preventDefault()}
          className="absolute right-0 mt-1 w-56 rounded-xl border border-line bg-surface p-2 text-sm shadow-soft"
        >
          <button
            type="button"
            onClick={() => shell.toggleFavourite(tool.id)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-ink hover:bg-[#eef0f3]"
          >
            <Star size={16} strokeWidth={1.75} className={isFav ? "fill-current text-ink" : "text-muted"} aria-hidden />
            {isFav ? "Remove from favourites" : "Add to favourites"}
          </button>

          <div className="my-1 h-px bg-line" />

          <div className="max-h-48 overflow-y-auto">
            {shell.state.groups.map((gid) => (
              <label key={gid} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#eef0f3]">
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
            <button type="button" onClick={addGroup} className="rounded-lg border border-line px-2 py-1 text-muted hover:text-ink">
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
