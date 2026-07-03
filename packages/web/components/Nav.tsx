"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { navShouldAnimate, bestMatchIndex } from "@/components/nav-anim";
import { HOME, SETTINGS, TOOL_LINKS, readNavOrder, NAV_ORDER_EVENT, type NavLink } from "@/components/nav-links";

export function Nav() {
  const path = usePathname();
  const [tools, setTools] = useState<NavLink[]>(TOOL_LINKS);
  const links: NavLink[] = [HOME, ...tools, SETTINGS];
  const activeIdx = bestMatchIndex(links.map((l) => l.href), path);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const prevPath = useRef<string | null>(null);
  const enabled = useRef(false);
  const [motionOK, setMotionOK] = useState(false);

  useEffect(() => {
    setMotionOK(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setTools(readNavOrder());
    const onOrder = () => setTools(readNavOrder());
    window.addEventListener(NAV_ORDER_EVENT, onOrder);
    return () => window.removeEventListener(NAV_ORDER_EVENT, onOrder);
  }, []);

  useLayoutEffect(() => {
    const el = linkRefs.current[activeIdx];
    const thumb = thumbRef.current;
    if (!el || !thumb) return;
    const willAnimate = navShouldAnimate(prevPath.current, path) && motionOK && enabled.current;
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
    prevPath.current = path;
    // Re-runs when `tools` changes so the thumb re-seats after a reorder.
  }, [path, activeIdx, motionOK, tools]);

  return (
    <header className="relative border-b border-line">
      <nav className="relative mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-6 py-3">
        <span ref={thumbRef} aria-hidden className="nav-thumb pointer-events-none absolute left-0 top-0 z-0 rounded-lg bg-ink" />
        {links.map(({ href, label, Icon }, i) => {
          const active = i === activeIdx;
          return (
            <Link
              key={href}
              href={href}
              ref={(el) => {
                linkRefs.current[i] = el;
              }}
              aria-current={active ? "page" : undefined}
              className={`relative z-10 inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "text-white" : "text-muted hover:text-ink"
              }`}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
