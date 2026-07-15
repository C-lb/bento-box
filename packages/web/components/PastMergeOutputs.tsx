"use client";
// "See past …" panel for the merge tools. Outputs are PDFs/zips, so rows are
// filename + date + Save + Remove (no thumbnails), shorten-style. The owning
// client records into history at download time via the hook's `record`, which
// is best-effort — a failed save never blocks or fails the download.
import { useCallback, useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import {
  addBlobHistory,
  listBlobHistory,
  removeBlobHistory,
  clearBlobHistory,
  newBlobHistoryId,
  type BlobHistoryItem,
} from "@/lib/blob-history";

export function usePastMergeOutputs(tool: string) {
  const [items, setItems] = useState<BlobHistoryItem[]>([]);

  useEffect(() => {
    let alive = true;
    listBlobHistory(tool).then((all) => { if (alive) setItems(all); });
    return () => { alive = false; };
  }, [tool]);

  const record = useCallback(
    (filename: string, blob: Blob) => {
      // Best-effort: never let a history failure surface to the download path.
      void (async () => {
        try {
          await addBlobHistory({ id: newBlobHistoryId(), tool, filename, at: Date.now(), blob });
          setItems(await listBlobHistory(tool));
        } catch {
          // ignore
        }
      })();
    },
    [tool],
  );

  const remove = useCallback(async (id: string) => {
    await removeBlobHistory(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clear = useCallback(async () => {
    await clearBlobHistory(tool);
    setItems([]);
  }, [tool]);

  return { items, record, remove, clear };
}

export function PastMergeOutputs({
  noun,
  items,
  onRemove,
  onClear,
}: {
  noun: string; // plural, e.g. "badges", "place cards"
  items: BlobHistoryItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  // One object URL per item for the Save links, revoked when the set changes.
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const it of items) map[it.id] = URL.createObjectURL(it.blob);
    setUrls(map);
    return () => { for (const u of Object.values(map)) URL.revokeObjectURL(u); };
  }, [items]);

  return (
    <div className="card">
      {items.length > 0 ? (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">See past {noun}</p>
            <button type="button" className="btn min-h-[44px] sm:min-h-0" onClick={onClear}>
              Clear all
            </button>
          </div>
          <ul className="mt-3 space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 border-t border-black/5 pt-3 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.filename}</p>
                  <p className="truncate text-sm text-muted">{new Date(item.at).toLocaleString()}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {urls[item.id] && (
                    <a
                      className="btn inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0"
                      href={urls[item.id]}
                      download={item.filename}
                    >
                      <Download className="w-4 h-4" strokeWidth={1.75} /> Save
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn min-h-[44px] sm:min-h-0"
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${item.filename} from history`}
                    data-tip="Remove"
                  >
                    <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted">Past {noun} appear here after you download.</p>
      )}
    </div>
  );
}
