import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function ToolCard({
  href,
  title,
  body,
  illustration,
  Icon,
}: {
  href: string;
  title: string;
  body: string;
  illustration: ReactNode;
  Icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="group block h-full rounded-[20px] border border-line bg-surface p-4 shadow-soft transition-colors hover:border-muted/40"
    >
      <div className="relative h-48 overflow-hidden rounded-2xl bg-[#eef0f3] p-4">
        {illustration}
      </div>
      <h2 className="mt-4 flex items-center gap-2 text-base font-semibold">
        <Icon size={18} strokeWidth={1.75} className="text-ink" aria-hidden />
        {title}
      </h2>
      <p className="mt-1.5 text-[13px] text-muted">{body}</p>
    </Link>
  );
}
