"use client";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useToolShell } from "@/components/tool-shell-context";
import { nextSearchVisibility } from "@/components/tool-store";

export function ToolSearch() {
  const { query, setQuery } = useToolShell();
  const [visible, setVisible] = useState(true);
  const [motionOK, setMotionOK] = useState(true);
  const lastY = useRef(0);

  useEffect(() => {
    setMotionOK(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    function onScroll() {
      const y = window.scrollY;
      setVisible(nextSearchVisibility(lastY.current, y, 8));
      lastY.current = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur ${
        motionOK ? "transition-transform duration-200" : ""
      }`}
      style={{ transform: visible ? "translateY(0)" : "translateY(-100%)" }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-0.5 sm:px-6 sm:py-2">
        <Search size={16} strokeWidth={1.75} className="h-3.5 w-3.5 text-muted sm:h-4 sm:w-4" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools by name or tag"
          aria-label="Search tools"
          className="min-h-9 w-full bg-transparent py-1 text-[13px] outline-none placeholder:text-muted sm:min-h-0 sm:text-sm"
        />
      </div>
    </div>
  );
}
