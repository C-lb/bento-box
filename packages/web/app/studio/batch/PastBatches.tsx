"use client";
import { HistoryPanel, historyWhen } from "@/components/HistoryPanel";

interface BatchRow {
  id: string; // batchId (HistoryPanel needs an id field)
  batchId: string;
  count: number;
  doneCount: number;
  createdAt: number;
}

export function PastBatches() {
  return (
    <HistoryPanel<BatchRow>
      buttonLabel="See past batches"
      panelTitle="Recent batches"
      emptyLabel="No batches yet."
      fetchItems={async () => {
        const r = await fetch("/api/studio/headshots?grouped=1");
        const d = await r.json().catch(() => null);
        const batches: Omit<BatchRow, "id">[] = d?.batches ?? [];
        return batches.map((b) => ({ ...b, id: b.batchId }));
      }}
      deleteItem={async (it) => {
        const r = await fetch(`/api/studio/batch/${it.batchId}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
      }}
      renderRow={(it) => (
        <div className="min-w-0">
          <span className="block truncate text-sm text-ink">
            {it.count} headshot{it.count === 1 ? "" : "s"}
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{historyWhen(it.createdAt)}</span>
            {it.doneCount < it.count && <span>· {it.doneCount} of {it.count} done</span>}
          </div>
        </div>
      )}
      renderActions={(it) =>
        it.doneCount > 0 ? (
          <a
            className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 inline-flex items-center text-xs text-ink underline underline-offset-2"
            href={`/api/studio/batch/${it.batchId}/zip`}
          >
            Download zip
          </a>
        ) : null
      }
    />
  );
}
