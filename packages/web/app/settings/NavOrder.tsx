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
