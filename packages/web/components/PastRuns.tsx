"use client";
import { HistoryPanel, historyWhen } from "@/components/HistoryPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { modeLabel, type ToolRunOutput } from "@/lib/past-runs";

interface Run {
  id: string;
  label: string;
  mode: string | null;
  outputs: ToolRunOutput[];
  createdAt: number;
}

// Shared "See past …" panel for the jobDir tools (pdf, resize, video, splice,
// convert, audio), backed by the generic /api/runs/[tool] routes. Rows outlive
// the on-disk files (swept ~6h after conversion), so the footer discloses that
// download links expire.
export function PastRuns({
  tool,
  buttonLabel,
  panelTitle,
  emptyLabel,
  fileUrl,
}: {
  tool: string;
  buttonLabel: string;
  panelTitle: string;
  emptyLabel: string;
  fileUrl: (output: ToolRunOutput) => string;
}) {
  return (
    <HistoryPanel<Run>
      buttonLabel={buttonLabel}
      panelTitle={panelTitle}
      emptyLabel={emptyLabel}
      fetchItems={async () => {
        const r = await fetch(`/api/runs/${encodeURIComponent(tool)}`);
        const d = await r.json().catch(() => null);
        return d?.runs ?? [];
      }}
      deleteItem={async (it) => {
        const r = await fetch(`/api/runs/${encodeURIComponent(tool)}/${encodeURIComponent(it.id)}`, {
          method: "DELETE",
        });
        if (!r.ok) throw new Error();
      }}
      renderRow={(it) => {
        const mode = modeLabel(it.mode);
        return (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm text-ink">{it.label}</span>
              {mode && <StatusBadge tone="idle" label={mode} />}
            </div>
            <div className="mt-1 text-xs text-muted">{historyWhen(it.createdAt)}</div>
          </>
        );
      }}
      renderActions={(it) => (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {it.outputs.map((o) => (
            <a
              key={`${o.id}-${o.filename}`}
              className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 inline-flex items-center text-xs text-ink underline underline-offset-2"
              href={fileUrl(o)}
              target="_blank"
              rel="noreferrer"
              download
            >
              {it.outputs.length === 1 ? "Download" : o.filename}
            </a>
          ))}
        </div>
      )}
      footer="Output files expire about 6 hours after a run. The rows here stay."
      align="left"
    />
  );
}
