import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function ToolCard({
  href,
  title,
  body,
  illustration,
  icons,
}: {
  href: string;
  title: string;
  body: string;
  illustration: ReactNode;
  icons: LucideIcon[];
}) {
  return (
    <Link
      href={href}
      className="block w-80 flex-none snap-start rounded-[20px] border border-line bg-surface p-4 shadow-soft transition-colors hover:border-muted/40"
    >
      <div className="relative h-48 overflow-hidden rounded-2xl bg-[#eef0f3] p-4">
        {illustration}
        <div className="absolute bottom-3 left-3 flex gap-2">
          {icons.map((Icon, i) => (
            <span key={i} className="grid h-9 w-9 place-items-center rounded-full bg-surface shadow-soft">
              <Icon size={18} strokeWidth={1.75} className="text-ink" aria-hidden />
            </span>
          ))}
        </div>
      </div>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm text-muted">{body}</p>
    </Link>
  );
}
