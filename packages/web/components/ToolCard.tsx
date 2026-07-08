import Link from "next/link";
import type { Tool } from "@/components/tools";
import { getIllustration } from "@/components/tool-illustrations";
import { CardMenu } from "@/components/CardMenu";

export function ToolCard({ tool }: { tool: Tool }) {
  const { Icon } = tool;
  return (
    <div className="group relative h-full rounded-[20px] border border-line bg-surface p-4 shadow-soft transition-colors hover:border-muted/40">
      <CardMenu tool={tool} />
      <Link href={tool.href} className="block">
        <div className="relative h-48 overflow-hidden rounded-2xl bg-[#eef0f3] p-4">{getIllustration(tool.id)}</div>
        <h2 className="mt-4 flex items-center gap-2 text-base font-semibold">
          <Icon size={18} strokeWidth={1.75} className="text-ink" aria-hidden />
          {tool.title}
        </h2>
        <p className="mt-1.5 text-[13px] text-muted">{tool.body}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {tool.tags.slice(0, 4).map((t) => (
            <span key={t} className="rounded-md bg-[#eef0f3] px-1.5 py-0.5 text-[11px] text-muted">
              {t}
            </span>
          ))}
          {tool.tags.length > 4 && <span className="px-1 py-0.5 text-[11px] text-muted">+{tool.tags.length - 4}</span>}
        </div>
      </Link>
    </div>
  );
}
