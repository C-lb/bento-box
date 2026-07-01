"use client";
import { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { transcriptionStatusView } from "@/lib/status";

interface Item {
  id: number;
  originalFilename: string;
  status: string;
  docUrl: string | null;
  createdAt: number;
}

function when(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function PastTranscriptions() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setLoading(true);
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

  return (
    <div className="relative">
      <button className="btn" onClick={toggle} aria-expanded={open}>See past transcriptions</button>
      {open && (
        <>
          {/* click-away closer */}
          <button
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="card absolute right-0 z-20 mt-2 w-[360px]">
            <p className="eyebrow">Recent transcriptions</p>
            {loading && <p className="mt-3 text-sm text-muted">Loading…</p>}
            {!loading && items && items.length === 0 && (
              <p className="mt-3 text-sm text-muted">No transcriptions yet.</p>
            )}
            {!loading && items && items.length > 0 && (
              <ul className="mt-3 space-y-4">
                {items.map((it) => (
                  <li key={it.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-ink">{it.originalFilename}</span>
                      <StatusBadge {...transcriptionStatusView(it.status)} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted">{when(it.createdAt)}</span>
                      {it.docUrl && (
                        <a
                          className="text-xs text-ink underline underline-offset-2"
                          href={it.docUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open in Google Docs
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
