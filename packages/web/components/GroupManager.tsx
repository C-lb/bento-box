"use client";
import { useRef, useState } from "react";
import { GripVertical, Star, Trash2 } from "lucide-react";
import { useToolShell } from "@/components/tool-shell-context";

export function GroupManager() {
  const shell = useToolShell();
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const rowRef = useRef<HTMLDivElement | null>(null);

  const ids = order ?? shell.state.groups;

  function onPointerDown(e: React.PointerEvent, i: number) {
    e.preventDefault();
    setOrder(shell.state.groups.slice());
    setDragIdx(i);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (dragIdx === null || !rowRef.current) return;
    const rows = Array.from(rowRef.current.querySelectorAll<HTMLElement>("[data-row]"));
    const y = e.clientY;
    let target = dragIdx;
    rows.forEach((p, j) => {
      const r = p.getBoundingClientRect();
      if (y > r.top + r.height / 2) target = Math.max(target, j);
      if (y < r.top + r.height / 2 && j <= dragIdx) target = Math.min(target, j);
    });
    if (target !== dragIdx) {
      setOrder((prev) => {
        const next = (prev ?? shell.state.groups).slice();
        const [m] = next.splice(dragIdx, 1);
        next.splice(target, 0, m);
        return next;
      });
      setDragIdx(target);
    }
  }
  function onPointerUp() {
    if (order) shell.reorderGroups(order);
    setOrder(null);
    setDragIdx(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted shadow-soft">
        <Star size={16} strokeWidth={1.75} className="fill-current text-ink" aria-hidden />
        Favourites
        <span className="ml-auto text-xs">pinned</span>
      </div>

      <div ref={rowRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="space-y-2">
        {ids.map((gid, i) => (
          <div
            key={gid}
            data-row
            className={`flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-soft ${
              dragIdx === i ? "opacity-70" : ""
            }`}
          >
            <button
              type="button"
              aria-label="Drag to reorder"
              onPointerDown={(e) => onPointerDown(e, i)}
              className="cursor-grab text-muted"
            >
              <GripVertical size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <input
              value={shell.state.groupLabels[gid] ?? gid}
              onChange={(e) => shell.renameGroup(gid, e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-ink outline-none"
              aria-label={`Rename ${shell.state.groupLabels[gid] ?? gid}`}
            />
            <button
              type="button"
              aria-label={`Delete ${shell.state.groupLabels[gid] ?? gid}`}
              onClick={() => shell.deleteGroup(gid)}
              className="text-muted hover:text-ink"
            >
              <Trash2 size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newGroup.trim()) {
              shell.createGroup(newGroup.trim());
              setNewGroup("");
            }
          }}
          placeholder="New group name"
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => {
            if (newGroup.trim()) {
              shell.createGroup(newGroup.trim());
              setNewGroup("");
            }
          }}
          className="rounded-xl border border-line px-3 py-2 text-sm text-muted hover:text-ink"
        >
          Add group
        </button>
      </div>
    </div>
  );
}
