"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Folder, FolderOpen, ChevronRight, Search, Loader2 } from "lucide-react";

export type PickedFolder = { id: string; name: string };

type Root = "root" | "shared";
const ROOT_LABEL: Record<Root, string> = { root: "My Drive", shared: "Shared with me" };

/** Drive folder chooser with breadcrumb navigation and whole-Drive search.
 *  Click a row to select it; use the chevron to walk into subfolders. */
export function FolderPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedFolder | null;
  onChange: (folder: PickedFolder | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState<Root>("root");
  const [path, setPath] = useState<PickedFolder[]>([]); // below the root
  const [items, setItems] = useState<PickedFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(async (params: string) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/drive/folders?${params}`);
      const data = await r.json().catch(() => null);
      if (seq !== reqSeq.current) return; // a newer request superseded this one
      if (!r.ok) {
        setError(r.status === 401 ? "Google is not connected. Connect it in Settings." : (data?.error ?? "Could not list folders."));
        setItems([]);
      } else {
        setItems(data?.folders ?? []);
      }
    } catch {
      if (seq === reqSeq.current) setError("Could not list folders.");
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, []);

  // Browse the current location whenever navigation state changes (and on open).
  useEffect(() => {
    if (!open || searching) return;
    const parent = path.length ? path[path.length - 1].id : root;
    load(`parent=${encodeURIComponent(parent)}`);
  }, [open, root, path, searching, load]);

  // Debounced whole-Drive search.
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (!term) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => load(`q=${encodeURIComponent(term)}`), 300);
    return () => clearTimeout(t);
  }, [query, open, load]);

  // Close on outside click and Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(folder: PickedFolder) {
    onChange(folder);
    setOpen(false);
  }

  function enter(folder: PickedFolder) {
    setQuery("");
    setSearching(false);
    setPath((p) => [...p, folder]);
  }

  const crumbs: { id: string; name: string; depth: number }[] = [
    { id: root, name: ROOT_LABEL[root], depth: 0 },
    ...path.map((f, i) => ({ id: f.id, name: f.name, depth: i + 1 })),
  ];

  return (
    <div ref={wrapRef} className="relative w-full sm:w-auto">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="field flex min-h-[44px] w-full items-center gap-2 text-left sm:min-h-0 sm:w-72"
      >
        <Folder size={14} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
        <span className={`truncate ${value ? "text-ink" : "text-muted"}`}>{value ? value.name : "Choose a folder"}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a Drive folder"
          className="absolute left-0 top-full z-30 mt-2 w-full rounded-lg border border-line bg-surface p-3 shadow-soft sm:w-96"
        >
          <div className="relative">
            <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              className="field w-full pl-8"
              placeholder="Search all folders"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>

          {!searching && (
            <div className="mt-2 flex items-center gap-1">
              {(Object.keys(ROOT_LABEL) as Root[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRoot(r);
                    setPath([]);
                  }}
                  className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    root === r && path.length === 0 ? "bg-raised text-ink shadow-raisededge" : "text-muted hover:text-ink"
                  }`}
                >
                  {ROOT_LABEL[r]}
                </button>
              ))}
            </div>
          )}

          {!searching && path.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
              {crumbs.map((c, i) => (
                <span key={c.id} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={12} strokeWidth={1.75} aria-hidden />}
                  {i < crumbs.length - 1 ? (
                    <button type="button" className="hover:text-ink" onClick={() => setPath(path.slice(0, c.depth))}>
                      {c.name}
                    </button>
                  ) : (
                    <span className="text-ink">{c.name}</span>
                  )}
                </span>
              ))}
              <button
                type="button"
                className="btn ml-auto px-2.5 py-1 text-xs"
                onClick={() => choose(path[path.length - 1])}
              >
                Use this folder
              </button>
            </div>
          )}

          <div className="mt-2 max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted">
                <Loader2 size={14} strokeWidth={1.75} className="animate-spin" aria-hidden />
                Loading folders
              </div>
            ) : error ? (
              <p className="px-2 py-4 text-sm text-danger">{error}</p>
            ) : items.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted">{searching ? "No folders match." : "No folders in here."}</p>
            ) : (
              <ul>
                {items.map((f) => (
                  <li key={f.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => choose(f)}
                      className="flex min-h-[40px] min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
                    >
                      <FolderOpen size={14} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
                      <span className="truncate">{f.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => enter(f)}
                      aria-label={`Open ${f.name}`}
                      data-tip="Open folder"
                      className="flex min-h-[40px] min-w-[36px] items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
                    >
                      <ChevronRight size={15} strokeWidth={1.75} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
