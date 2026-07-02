"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Images, Mic, UserRound, Settings, LayoutGrid, Scissors, type LucideIcon } from "lucide-react";

const LINKS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/sorter", label: "Photo sorter", Icon: Images },
  { href: "/transcribe", label: "Audio transcriber", Icon: Mic },
  { href: "/studio", label: "Headshot studio", Icon: UserRound },
  { href: "/studio/batch", label: "Batch", Icon: LayoutGrid },
  { href: "/slice", label: "Slide slicer", Icon: Scissors },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function Nav() {
  const path = usePathname();

  // Longest-prefix-wins: among all links whose href is a prefix of the current
  // path, pick the one with the longest href so /studio/batch beats /studio.
  const bestMatch = LINKS.filter((l) =>
    l.href === "/" ? path === "/" : path === l.href || path.startsWith(l.href + "/")
  ).sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <header className="border-b border-line">
      <nav className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-6 py-3">
        {LINKS.map(({ href, label, Icon }) => {
          const active = href === bestMatch?.href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${
                active ? "bg-raised text-ink shadow-raisededge" : "text-muted hover:text-ink"
              }`}
            >
              <Icon size={16} aria-hidden />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
