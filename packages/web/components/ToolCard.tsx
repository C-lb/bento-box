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
      <div className="flex min-h-[48px] items-center gap-3 pr-16 sm:hidden">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef0f3]">
          <Icon size={18} strokeWidth={1.75} className="text-ink" aria-hidden />
        </span>
        <span className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{tool.title}</h2>
          <p className="mt-0.5 line-clamp-1 text-sm text-muted">{tool.body}</p>
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
    <div className="group relative h-full rounded-[20px] border border-line bg-surface p-3 shadow-soft transition-colors hover:border-muted/40 sm:p-4">
      <CardMenu tool={tool} />
      {blocked && readiness && <RequirementBadge readiness={readiness} />}
      {blocked ? (
        <div
          aria-disabled="true"
          className="-m-3 block cursor-not-allowed p-3 opacity-45 sm:m-0 sm:p-0"
        >
          {inner}
        </div>
      ) : (
        <Link href={tool.href} className="-m-3 block p-3 sm:m-0 sm:p-0">
          {inner}
        </Link>
      )}
    </div>
  );
}
