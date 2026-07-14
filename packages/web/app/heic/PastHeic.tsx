"use client";
import { HistoryPanel, historyWhen } from "@/components/HistoryPanel";

interface Item {
  id: number;
  jobId: string;
  sourceFilename: string;
  outFilename: string;
  outFormat: string;
  expired: boolean;
}
interface Batch {
  batchId: string;
  createdAt: number;
  items: Item[];
}
type BatchItem = Batch & { id: string };

function downloadHref(it: Item): string {
  return `/api/heic/${it.jobId}?name=${encodeURIComponent(it.outFilename)}&format=${it.outFormat}`;
}

// Batches with more than one file are bundled under a single "N photos" row with
// a download link per file; a single conversion shows on its own.
export function PastHeic() {
  return (
    <HistoryPanel<BatchItem>
      buttonLabel="See past conversions"
      panelTitle="Recent conversions"
      emptyLabel="No conversions yet."
      fetchItems={async () => {
        const r = await fetch("/api/heic/history");
        const d = await r.json().catch(() => null);
        return (d?.batches ?? []).map((b: Batch) => ({ ...b, id: b.batchId }));
      }}
      deleteItem={async (it) => {
        const r = await fetch(`/api/heic/history/${encodeURIComponent(it.batchId)}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
      }}
      renderRow={(b) => {
        const single = b.items.length === 1;
        return (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm text-ink">
                {single ? b.items[0].sourceFilename : `${b.items.length} photos`}
              </span>
              <span className="text-xs text-muted">{b.items[0]?.outFormat}</span>
            </div>
            <div className="mt-1 text-xs text-muted">{historyWhen(b.createdAt)}</div>
          </>
        );
      }}
      renderActions={(b) => (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {b.items.map((it) =>
            it.expired ? (
              <span key={it.id} className="text-xs text-muted">{b.items.length === 1 ? "Expired" : `${it.outFilename} (expired)`}</span>
            ) : (
              <a
                key={it.id}
                className="text-xs text-ink underline underline-offset-2"
                href={downloadHref(it)}
                target="_blank"
                rel="noreferrer"
                download
              >
                {b.items.length === 1 ? "Download" : it.outFilename}
              </a>
            ),
          )}
        </div>
      )}
    />
  );
}
