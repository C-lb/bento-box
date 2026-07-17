"use client";
import { useEffect, useState } from "react";
import { TOOLS } from "@/components/tools";
import { visibleTools } from "@/components/tool-store";
import { useToolShell } from "@/components/tool-shell-context";
import { ToolCard } from "@/components/ToolCard";
import { toolReadiness, type Health } from "@/components/tool-readiness";

export function ToolGrid() {
  const { state, activeGroup, query } = useToolShell();
  const tools = visibleTools(state, TOOLS, activeGroup, query);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: Health) => {
        if (alive) setHealth(h);
      })
      .catch(() => {
        // Fail open: unknown health leaves every card clickable.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (tools.length === 0) {
    const msg = query.trim()
      ? `No tools match "${query.trim()}"`
      : "No tools in this group yet";
    return <p className="py-16 text-center text-sm text-muted">{msg}</p>;
  }

  // Pair each tool with its readiness, then sink the not-ready (unusable) tools
  // to the bottom so ready tools lead. Stable: within each group the original
  // order is preserved. While health is still loading, readiness is undefined
  // for every tool, so nothing is reordered (fail-open ordering too).
  const cards = tools.map((t) => ({ tool: t, readiness: health ? toolReadiness(t, health) : undefined }));
  const ordered = [
    ...cards.filter((c) => !c.readiness || c.readiness.ready),
    ...cards.filter((c) => c.readiness && !c.readiness.ready),
  ];

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-5">
      {ordered.map(({ tool, readiness }) => (
        <ToolCard key={tool.id} tool={tool} readiness={readiness} />
      ))}
    </div>
  );
}
