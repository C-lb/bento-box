"use client";
import { HistoryPanel, historyWhen } from "@/components/HistoryPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { headshotStatusView } from "@/lib/status";

interface Shot {
  id: number;
  status: string;
  nameText: string | null;
  titleText: string | null;
  imageUrl: string | null;
  downloadUrl: string | null;
  createdAt: number;
  renderer: string;
  source: string;
}

export function PastHeadshots() {
  return (
    <HistoryPanel<Shot>
      buttonLabel="See past headshots"
      panelTitle="Recent headshots"
      emptyLabel="No headshots yet."
      fetchItems={async () => {
        const r = await fetch("/api/studio/headshots");
        const d = await r.json().catch(() => null);
        return d?.headshots ?? [];
      }}
      deleteItem={async (it) => {
        const r = await fetch(`/api/studio/headshots/${it.id}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
      }}
      renderRow={(it) => (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="block truncate text-sm text-ink">{it.nameText || "Untitled"}</span>
            {it.titleText && <span className="block truncate text-xs text-muted">{it.titleText}</span>}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{historyWhen(it.createdAt)}</span>
              <span>· {it.renderer === "canva" ? "Canva" : "Local"}</span>
              <StatusBadge {...headshotStatusView(it.status)} />
            </div>
          </div>
          {it.imageUrl && <img src={it.imageUrl} alt="" className="h-10 w-10 flex-none rounded-md object-cover" />}
        </div>
      )}
      renderActions={(it) =>
        it.downloadUrl ? (
          <a className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 inline-flex items-center text-xs text-ink underline underline-offset-2" href={it.downloadUrl} target="_blank" rel="noreferrer">
            Download
          </a>
        ) : null
      }
    />
  );
}
