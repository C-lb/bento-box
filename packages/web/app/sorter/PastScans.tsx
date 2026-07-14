"use client";
import { HistoryPanel, historyWhen } from "@/components/HistoryPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { jobStatusView } from "@/lib/status";

interface Scan {
  id: number;
  driveFolderName: string;
  platform: string | null;
  status: string;
  total: number;
  processed: number;
  createdAt: number;
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  profile: "Profile picture",
};

export function PastScans() {
  return (
    <HistoryPanel<Scan>
      buttonLabel="See past scans"
      panelTitle="Recent scans"
      emptyLabel="No scans yet."
      fetchItems={async () => {
        const r = await fetch("/api/sorter/jobs");
        const d = await r.json().catch(() => null);
        return d?.jobs ?? [];
      }}
      deleteItem={async (it) => {
        const r = await fetch(`/api/sorter/jobs/${it.id}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
      }}
      renderActions={(it) => (
        <a className="text-xs text-ink underline underline-offset-2" href={`/sorter?job=${it.id}`}>
          Open
        </a>
      )}
      renderRow={(it) => (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm text-ink">{it.driveFolderName}</span>
            <StatusBadge {...jobStatusView(it.status)} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{historyWhen(it.createdAt)}</span>
            {it.platform && PLATFORM_LABEL[it.platform] && <span>· {PLATFORM_LABEL[it.platform]}</span>}
            <span>· {it.processed} of {it.total}</span>
          </div>
        </>
      )}
    />
  );
}
