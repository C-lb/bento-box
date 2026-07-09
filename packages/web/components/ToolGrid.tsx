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

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} readiness={health ? toolReadiness(t, health) : undefined} />
      ))}
    </div>
  );
}
