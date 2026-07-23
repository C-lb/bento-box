"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keyboard shortcuts. Menu accelerators in the desktop shell (Cmd/Ctrl+1/2,
// Settings, back/forward) arrive over the preload bridge as ee:nav paths;
// Cmd/Ctrl+K and "/" are handled in-page so they also work in a plain browser
// tab (e.g. the Tailscale funnel).
export function DesktopShortcuts() {
  const router = useRouter();

  useEffect(() => {
    window.ee?.onNav?.((path) => router.push(path));
  }, [router]);

  useEffect(() => {
    function isTyping(el: EventTarget | null) {
      if (!(el instanceof HTMLElement)) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    }
    function focusSearch() {
      const input = document.getElementById("tool-search-input") as HTMLInputElement | null;
      if (!input) return false;
      input.focus();
      input.select();
      return true;
    }
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        focusSearch();
      } else if (e.key === "/" && !mod && !e.altKey && !isTyping(e.target)) {
        if (focusSearch()) e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
