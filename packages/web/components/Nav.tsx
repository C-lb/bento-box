"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Home, Images, Mic, UserRound, Settings, Scissors, type LucideIcon } from "lucide-react";
import { navShouldAnimate, bestMatchIndex } from "@/components/nav-anim";

const LINKS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/sorter", label: "Photo sorter", Icon: Images },
  { href: "/transcribe", label: "Audio transcriber", Icon: Mic },
  { href: "/studio", label: "Headshot studio", Icon: UserRound },
  { href: "/slice", label: "Slide slicer", Icon: Scissors },
  { href: "/settings", label: "Settings", Icon: Settings },
];

const STAR = '<svg viewBox="0 0 24 24" fill="#1a1d23" width="100%" height="100%"><path d="M12 1.6l3.09 6.26 6.91.99-5 4.87 1.18 6.88L12 18.9l-6.18 3.25L7 15.72l-5-4.87 6.91-.99z"/></svg>';

export function Nav() {
  const path = usePathname();
  const activeIdx = bestMatchIndex(LINKS.map((l) => l.href), path);
  const activeIdxRef = useRef(activeIdx);
  activeIdxRef.current = activeIdx;
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const fxRef = useRef<HTMLSpanElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const prevPath = useRef<string | null>(null);
  const enabled = useRef(false);
  const [motionOK, setMotionOK] = useState(false);
  const [settledIdx, setSettledIdx] = useState(activeIdx);

  useEffect(() => {
    setMotionOK(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
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
      setSettledIdx(activeIdx);
      requestAnimationFrame(() => {
        if (thumbRef.current) thumbRef.current.style.transition = "";
        enabled.current = true;
      });
    } else {
      setSettledIdx(-1);
    }
    prevPath.current = path;
  }, [path, activeIdx, motionOK]);

  useEffect(() => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "transform") {
        setSettledIdx(activeIdxRef.current);
        if (motionOK) burst();
      }
    };
    thumb.addEventListener("transitionend", onEnd);
    return () => thumb.removeEventListener("transitionend", onEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionOK]);

  function burst() {
    const el = linkRefs.current[activeIdxRef.current];
    const fx = fxRef.current;
    const header = headerRef.current;
    if (!el || !fx || !header) return;
    const r = el.getBoundingClientRect();
    const h = header.getBoundingClientRect();
    const cx = r.left - h.left + r.width / 2;
    const cy = r.top - h.top + r.height / 2;
    for (let i = 0; i < 6; i++) {
      const s = document.createElement("span");
      s.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;`;
      s.innerHTML = STAR;
      fx.appendChild(s);
      const ang = ((-90 + (i / 6) * 360) * Math.PI) / 180;
      const rad = 26 + (i % 3) * 10;
      const dx = Math.cos(ang) * rad;
      const dy = Math.sin(ang) * rad - 6;
      const rot = (i % 2 ? 1 : -1) * (120 + i * 20);
      s.animate(
        [
          { transform: "translate(0,0) scale(.2)", opacity: 1 },
          { transform: `translate(${dx * 0.6}px,${dy * 0.6}px) scale(1)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${dx}px,${dy}px) scale(.4) rotate(${rot}deg)`, opacity: 0 },
        ],
        { duration: 620, easing: "cubic-bezier(.25,.7,.3,1)" }
      ).onfinish = () => s.remove();
    }
  }

  return (
    <header ref={headerRef} className="relative border-b border-line">
      <span ref={fxRef} aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-visible" />
      <nav className="relative mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-6 py-3">
        <span ref={thumbRef} aria-hidden className="nav-thumb pointer-events-none absolute left-0 top-0 z-0 rounded-lg bg-ink" />
        {LINKS.map(({ href, label, Icon }, i) => {
          const active = i === activeIdx;
          const settled = i === settledIdx;
          return (
            <Link
              key={href}
              href={href}
              ref={(el) => {
                linkRefs.current[i] = el;
              }}
              aria-current={active ? "page" : undefined}
              className={`relative z-10 inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                settled ? "text-white" : active ? "text-ink" : "text-muted hover:text-ink"
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
