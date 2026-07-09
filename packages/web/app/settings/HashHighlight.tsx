"use client";
import { useEffect } from "react";

// When Settings is opened via a deep link like /settings#api-keys, briefly
// ring the target heading so it's obvious where to look. No-op without a hash.
export function HashHighlight() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.classList.add("ring-2", "ring-amber-400", "rounded-md", "ring-offset-2");
    const t = setTimeout(() => {
      el.classList.remove("ring-2", "ring-amber-400", "rounded-md", "ring-offset-2");
    }, 1600);
    return () => clearTimeout(t);
  }, []);
  return null;
}
