import Link from "next/link";
import type { Tool } from "@/components/tools";
import { getIllustration } from "@/components/tool-illustrations";
import { CardMenu } from "@/components/CardMenu";
import { RequirementBadge } from "@/components/RequirementBadge";
import type { Readiness } from "@/components/tool-readiness";

export function ToolCard({ tool, readiness }: { tool: Tool; readiness?: Readiness }) {
  const { Icon } = tool;
  const blocked = readiness ? !readiness.ready : false;

  const inner = (
    <>
      {/* Mobile: compact list row (icon tile + title + one-line body). */}
      <div className="flex min-h-10 items-center gap-2.5 pr-10 sm:hidden">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef0f3]">
          <Icon size={18} strokeWidth={1.75} className="h-4 w-4 text-ink" aria-hidden />
        </span>
        <span className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{tool.title}</h2>
          <p className="mt-0 line-clamp-1 text-[13px] text-muted">{tool.body}</p>
        </span>
      </div>

      {/* Desktop: full card with illustration, body, and tags. */}
      <div className="hidden sm:block">
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
      </div>
    </>
  );

  return (
    <div className="group relative h-full rounded-2xl border border-line bg-surface p-2 shadow-soft transition-colors hover:border-muted/40 sm:rounded-[20px] sm:p-4">
      <CardMenu tool={tool} />
      {blocked && readiness && <RequirementBadge readiness={readiness} />}
      {blocked ? (
        <div
          aria-disabled="true"
          className="-m-2 block cursor-not-allowed p-2 opacity-45 sm:m-0 sm:p-0"
        >
          {inner}
        </div>
      ) : (
        <Link href={tool.href} className="-m-2 block p-2 sm:m-0 sm:p-0">
          {inner}
        </Link>
      )}
    </div>
  );
}
