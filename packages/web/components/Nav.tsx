"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Images, Mic, UserRound, Settings, type LucideIcon } from "lucide-react";

const LINKS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/sorter", label: "Photo sorter", Icon: Images },
  { href: "/transcribe", label: "Audio transcriber", Icon: Mic },
  { href: "/studio", label: "Headshot studio", Icon: UserRound },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="border-b border-line">
      <nav className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-6 py-3">
        {LINKS.map(({ href, label, Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
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
