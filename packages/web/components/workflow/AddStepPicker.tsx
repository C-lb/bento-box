"use client";

import { useState } from "react";
import { TOOLS, searchTools } from "@/components/tools";
import { compatibleNextTools } from "@/lib/workflow/compat";
import type { StepKind } from "@/lib/workflow/types";

export function AddStepPicker({
  prevOutputKind,
  onPick,
  onClose,
}: {
  prevOutputKind: StepKind | null;
  onPick: (toolId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const allowedIds = new Set(compatibleNextTools(prevOutputKind).map((k) => k.toolId));
  const candidates = searchTools(TOOLS, query).filter((t) => allowedIds.has(t.id));

  return (
    <div className="rounded-lg border border-line/60 bg-surface p-3">
      <input
        autoFocus
        placeholder="Search tools…"
        className="w-full rounded-md border border-line/60 bg-transparent p-2 text-sm"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {candidates.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          No tool's input matches the last step's output — this is expected for sorter/transcribe/studio, which
          usually stand alone.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line/60">
          {candidates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 py-2 text-left text-sm hover:text-ink"
                onClick={() => onPick(t.id)}
              >
                <t.Icon size={16} aria-hidden />
                {t.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="mt-2 text-xs text-muted underline underline-offset-2" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
