"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { transcriptionStatusView } from "@/lib/status";

interface Item {
  id: number;
  originalFilename: string;
  status: string;
  docUrl: string | null;
  createdAt: number;
  hasLinkedin: boolean;
  hasArticle: boolean;
}

function when(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function PastTranscriptions() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearingId, setClearingId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  async function reload() {
    setLoading(true);
    setRowError(null);
    try {
      const r = await fetch("/api/transcribe");
      const d = await r.json().catch(() => null);
      setItems(d?.transcriptions ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) reload();
  }

  function openRow(id: number) {
    router.push(`/transcribe?id=${id}`);
    setOpen(false);
  }

  async function clearDrafts(id: number) {
    setClearingId(id);
    setRowError(null);
    try {
      const r = await fetch(`/api/transcribe/${id}/summary`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      await reload();
    } catch {
      setRowError({ id, message: "Could not clear drafts." });
    } finally {
      setClearingId(null);
    }
  }

  async function doDelete(id: number) {
    setDeletingId(id);
    setRowError(null);
    try {
      const r = await fetch(`/api/transcribe/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      setConfirmingId(null);
      await reload();
    } catch {
      setRowError({ id, message: "Could not delete." });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="relative">
      <button className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto" onClick={toggle} aria-expanded={open}>See past transcriptions</button>
      {open && (
        <>
          {/* click-away closer */}
          <button
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="card absolute right-0 z-20 mt-2 w-[calc(100vw-2.5rem)] max-w-[420px] sm:w-[420px]">
            <p className="eyebrow">Recent transcriptions</p>
            {loading && <p className="mt-3 text-sm text-muted">Loading…</p>}
            {!loading && items && items.length === 0 && (
              <p className="mt-3 text-sm text-muted">No transcriptions yet.</p>
            )}
            {!loading && items && items.length > 0 && (
              <ul className="mt-3 max-h-[420px] divide-y divide-line/60 overflow-y-auto pr-1">
                {items.map((it) => {
                  const rowBusy = clearingId === it.id || deletingId === it.id;
                  return (
                    <li key={it.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-ink">{it.originalFilename}</span>
                        <StatusBadge {...transcriptionStatusView(it.status)} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted">{when(it.createdAt)}</span>
                        {it.hasLinkedin && <span className="text-xs text-muted">· LinkedIn</span>}
                        {it.hasArticle && <span className="text-xs text-muted">· Article</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-xs text-ink underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                          onClick={() => openRow(it.id)}
                          disabled={rowBusy}
                        >
                          Open
                        </button>
                        {it.docUrl && (
                          <a
                            className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 inline-flex items-center text-xs text-ink underline underline-offset-2"
                            href={it.docUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in Google Docs
                          </a>
                        )}
                        <button
                          type="button"
                          className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-xs text-ink underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                          onClick={() => clearDrafts(it.id)}
                          disabled={rowBusy}
                        >
                          {clearingId === it.id ? "Clearing…" : "Clear drafts"}
                        </button>
                        {confirmingId === it.id ? (
                          <span className="flex items-center gap-2 text-xs">
                            <span className="text-danger">Delete?</span>
                            <button
                              type="button"
                              className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-danger underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                              onClick={() => doDelete(it.id)}
                              disabled={deletingId === it.id}
                            >
                              {deletingId === it.id ? "Deleting…" : "Yes"}
                            </button>
                            <button
                              type="button"
                              className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-ink underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                              onClick={() => setConfirmingId(null)}
                              disabled={deletingId === it.id}
                            >
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-xs text-danger underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                            onClick={() => setConfirmingId(it.id)}
                            disabled={rowBusy}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                      {rowError?.id === it.id && (
                        <p className="mt-2 text-xs text-danger">{rowError.message}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
