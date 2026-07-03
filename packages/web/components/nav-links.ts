"use client";
import { Home, Images, Mic, UserRound, Settings, Scissors, AudioLines, type LucideIcon } from "lucide-react";

export type NavLink = { href: string; label: string; Icon: LucideIcon };

export const HOME: NavLink = { href: "/", label: "Home", Icon: Home };
export const SETTINGS: NavLink = { href: "/settings", label: "Settings", Icon: Settings };

// Default order; reorderable via the store below.
export const TOOL_LINKS: NavLink[] = [
  { href: "/sorter", label: "Photo sorter", Icon: Images },
  { href: "/transcribe", label: "Audio transcriber", Icon: Mic },
  { href: "/studio", label: "Headshot studio", Icon: UserRound },
  { href: "/slice", label: "Slide slicer", Icon: Scissors },
  { href: "/convert", label: "Audio converter", Icon: AudioLines },
];

export const NAV_ORDER_KEY = "ee.navOrder";
export const NAV_ORDER_EVENT = "ee:nav-order-change";

// Reorder TOOL_LINKS by a stored href list. Unknown/duplicate hrefs are dropped;
// tools absent from the list are appended in default order.
export function orderTools(stored: string[]): NavLink[] {
  const byHref = new Map(TOOL_LINKS.map((l) => [l.href, l]));
  const seen = new Set<string>();
  const out: NavLink[] = [];
  for (const href of stored) {
    const link = byHref.get(href);
    if (link && !seen.has(href)) {
      out.push(link);
      seen.add(href);
    }
  }
  for (const link of TOOL_LINKS) {
    if (!seen.has(link.href)) out.push(link);
  }
  return out;
}

export function parseNavOrder(raw: string | null): NavLink[] {
  if (!raw) return TOOL_LINKS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return TOOL_LINKS;
    return orderTools(parsed.filter((h): h is string => typeof h === "string"));
  } catch {
    return TOOL_LINKS;
  }
}

export function readNavOrder(): NavLink[] {
  if (typeof window === "undefined") return TOOL_LINKS;
  return parseNavOrder(window.localStorage.getItem(NAV_ORDER_KEY));
}

export function writeNavOrder(hrefs: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(hrefs));
  window.dispatchEvent(new CustomEvent(NAV_ORDER_EVENT));
}
