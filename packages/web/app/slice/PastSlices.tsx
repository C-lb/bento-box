"use client";
import { HistoryPanel, historyWhen } from "@/components/HistoryPanel";
import { StatusBadge } from "@/components/StatusBadge";

interface Run {
  runId: string;
  sourceFilename: string;
  status: string;
  createdAt: number;
  expired: boolean;
}
type RunItem = Run & { id: string };

function badge(r: Run): { tone: "idle" | "active" | "success" | "error"; label: string } {
  if (r.expired) return { tone: "idle", label: "Expired" };
  if (r.status === "sliced") return { tone: "success", label: "Sliced" };
  return { tone: "idle", label: "Converted" };
}

export function PastSlices() {
  return (
    <HistoryPanel<RunItem>
      buttonLabel="See past slices"
      panelTitle="Recent slices"
      emptyLabel="No slices yet."
      fetchItems={async () => {
        const r = await fetch("/api/slice/runs");
        const d = await r.json().catch(() => null);
        return (d?.runs ?? []).map((x: Run) => ({ ...x, id: x.runId }));
      }}
      deleteItem={async (it) => {
        const r = await fetch(`/api/slice/runs/${encodeURIComponent(it.runId)}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
      }}
      renderRow={(it) => (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm text-ink">{it.sourceFilename}</span>
            <StatusBadge {...badge(it)} />
          </div>
          <div className="mt-1 text-xs text-muted">{historyWhen(it.createdAt)}</div>
        </>
      )}
      renderActions={(it) =>
        it.status === "sliced" && !it.expired ? (
          <a
            className="text-xs text-ink underline underline-offset-2"
            href={`/api/slice/${encodeURIComponent(it.runId)}/zip`}
            target="_blank"
            rel="noreferrer"
          >
            Download zip
          </a>
        ) : null
      }
    />
  );
}
