"use client";
import { TOOLS } from "@/components/tools";
import { visibleTools } from "@/components/tool-store";
import { useToolShell } from "@/components/tool-shell-context";
import { ToolCard } from "@/components/ToolCard";

export function ToolGrid() {
  const { state, activeGroup, query } = useToolShell();
  const tools = visibleTools(state, TOOLS, activeGroup, query);

  if (tools.length === 0) {
    const msg = query.trim()
      ? `No tools match "${query.trim()}"`
      : "No tools in this group yet";
    return <p className="py-16 text-center text-sm text-muted">{msg}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} />
      ))}
    </div>
  );
}
