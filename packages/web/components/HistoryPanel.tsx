"use client";
import { useState, type ReactNode } from "react";

export interface HistoryItem {
  id: string | number;
}

export function historyWhen(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function HistoryPanel<T extends HistoryItem>({
  buttonLabel,
  panelTitle,
  emptyLabel,
  fetchItems,
  renderRow,
  renderActions,
  deleteItem,
  footer,
  align = "right",
}: {
  buttonLabel: string;
  panelTitle: string;
  emptyLabel: string;
  fetchItems: () => Promise<T[]>;
  renderRow: (item: T) => ReactNode;
  renderActions?: (item: T) => ReactNode;
  deleteItem?: (item: T) => Promise<void>;
  footer?: ReactNode;
  /**
   * Which button edge the dropdown hugs. Use "left" when the trigger sits
   * near the left side of the page so the 420px panel opens rightward
   * instead of hanging off the viewport.
   */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<T["id"] | null>(null);
  const [deletingId, setDeletingId] = useState<T["id"] | null>(null);
  const [rowError, setRowError] = useState<{ id: T["id"]; message: string } | null>(null);

  async function reload() {
    setLoading(true);
    setRowError(null);
    try {
      setItems(await fetchItems());
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

  async function doDelete(item: T) {
    if (!deleteItem) return;
    setDeletingId(item.id);
    setRowError(null);
    try {
      await deleteItem(item);
      setConfirmingId(null);
      await reload();
    } catch {
      setRowError({ id: item.id, message: "Could not delete." });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="relative">
      <button className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto" onClick={toggle} aria-expanded={open}>{buttonLabel}</button>
      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            className={`card absolute z-20 mt-2 w-[calc(100vw-2.5rem)] max-w-[420px] sm:w-[420px] ${align === "left" ? "left-0" : "right-0"}`}
          >
            <p className="eyebrow">{panelTitle}</p>
            {loading && <p className="mt-3 text-sm text-muted">Loading…</p>}
            {!loading && items && items.length === 0 && <p className="mt-3 text-sm text-muted">{emptyLabel}</p>}
            {!loading && items && items.length > 0 && (
              <ul className="mt-3 max-h-[420px] divide-y divide-line/60 overflow-y-auto pr-1">
                {items.map((item) => {
                  const rowBusy = deletingId === item.id;
                  return (
                    <li key={String(item.id)} className="py-3 first:pt-0 last:pb-0">
                      {renderRow(item)}
                      {(renderActions || deleteItem) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1 sm:gap-3">
                          {renderActions?.(item)}
                          {deleteItem &&
                            (confirmingId === item.id ? (
                              <span className="flex items-center gap-2 text-xs">
                                <span className="text-danger">Delete?</span>
                                <button
                                  type="button"
                                  className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-danger underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                  onClick={() => doDelete(item)}
                                  disabled={rowBusy}
                                >
                                  {rowBusy ? "Deleting…" : "Yes"}
                                </button>
                                <button
                                  type="button"
                                  className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-ink underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                  onClick={() => setConfirmingId(null)}
                                  disabled={rowBusy}
                                >
                                  No
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-xs text-danger underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                onClick={() => setConfirmingId(item.id)}
                                disabled={rowBusy}
                              >
                                Delete
                              </button>
                            ))}
                        </div>
                      )}
                      {rowError?.id === item.id && <p className="mt-2 text-xs text-danger">{rowError.message}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            {footer && <p className="mt-3 text-xs text-muted">{footer}</p>}
          </div>
        </>
      )}
    </div>
  );
}
