"use client";
import { useEffect, useRef, useState } from "react";
import { FRAME_LIST } from "@event-editor/core/frames";
import { detectColumns } from "@event-editor/core/columns";

interface Folder { id: string; name: string; }
type MatchStatus = "matched" | "ambiguous" | "unmatched";
interface RowMatch { status: MatchStatus; driveFileId?: string; candidates?: string[]; }
interface MatchedRow { index: number; name: string; title: string; match: RowMatch; }
type Mapping = { name: number | null; title: number | null; photo: number | null };

function StatusChip({ status }: { status: MatchStatus }) {
  if (status === "matched") {
    return (
      <span className="inline-block rounded-full bg-green-50 px-2 py-0.5 text-xs text-success">
        Matched
      </span>
    );
  }
  if (status === "ambiguous") {
    return (
      <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
        Ambiguous
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-muted">
      Unmatched
    </span>
  );
}

export function StudioBatchClient() {
  // Google Drive connection
  const [connected, setConnected] = useState<boolean | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);

  // Sheet input
  const [spreadsheetInput, setSpreadsheetInput] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [tabError, setTabError] = useState<"google" | "sheets" | null>(null);

  // Sheet values
  const [tab, setTab] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({ name: null, title: null, photo: null });

  // Renderer
  const [renderer, setRenderer] = useState<"local" | "canva">("local");
  const [canvaConnected, setCanvaConnected] = useState<boolean | null>(null);
  const [templates, setTemplates] = useState<{ id: string; title: string }[]>([]);
  const [styleId, setStyleId] = useState<string>(FRAME_LIST[0]?.id ?? "");

  // Folder
  const [folderId, setFolderId] = useState("");

  // Match
  const [matchLoading, setMatchLoading] = useState(false);
  const [matched, setMatched] = useState<MatchedRow[]>([]);
  const [matchErr, setMatchErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const selectAllRef = useRef<HTMLInputElement>(null);

  // Load Drive folders on mount
  useEffect(() => {
    fetch("/api/drive/folders").then(async (r) => {
      if (r.status === 401) { setConnected(false); return; }
      setConnected(true);
      setFolders((await r.json()).folders ?? []);
    }).catch(() => setConnected(false));
  }, []);

  // Load Canva templates when renderer switches to canva
  useEffect(() => {
    if (renderer !== "canva" || canvaConnected !== null) return;
    fetch("/api/studio/templates").then(async (r) => {
      if (r.status === 401) { setCanvaConnected(false); return; }
      setCanvaConnected(true);
      setTemplates((await r.json()).templates ?? []);
    }).catch(() => setCanvaConnected(false));
  }, [renderer, canvaConnected]);

  // Reset styleId when renderer changes
  useEffect(() => {
    if (renderer === "local") setStyleId(FRAME_LIST[0]?.id ?? "");
    else setStyleId("");
  }, [renderer]);

  // Keep select-all indeterminate state in sync
  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const selectableIndices = matched
      .map((_, i) => i)
      .filter((i) => matched[i].match.status === "matched");
    const selectedCount = selectableIndices.filter((i) => selected.has(i)).length;
    el.indeterminate = selectedCount > 0 && selectedCount < selectableIndices.length;
  }, [selected, matched]);

  async function loadTabs() {
    const raw = spreadsheetInput.trim();
    if (!raw) return;
    setTabsLoading(true);
    setTabs([]);
    setTab("");
    setHeader([]);
    setRows([]);
    setMapping({ name: null, title: null, photo: null });
    setMatched([]);
    setSelected(new Set());
    setTabError(null);
    try {
      const r = await fetch(
        `/api/studio/sheets/tabs?spreadsheetId=${encodeURIComponent(raw)}`
      );
      if (r.status === 401) { setTabError("google"); return; }
      if (r.status === 403) { setTabError("sheets"); return; }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "request failed");
      setSpreadsheetId(raw);
      setTabs(d.tabs ?? []);
    } catch {
      setTabError("google");
    } finally {
      setTabsLoading(false);
    }
  }

  async function loadValues(chosenTab: string) {
    setTab(chosenTab);
    setHeader([]);
    setRows([]);
    setMapping({ name: null, title: null, photo: null });
    setMatched([]);
    setSelected(new Set());
    if (!chosenTab) return;
    try {
      const r = await fetch(
        `/api/studio/sheets/values?spreadsheetId=${encodeURIComponent(spreadsheetId)}&tab=${encodeURIComponent(chosenTab)}`
      );
      if (!r.ok) return;
      const d = await r.json();
      const h: string[] = d.header ?? [];
      setHeader(h);
      setRows(d.rows ?? []);
      setMapping(detectColumns(h));
    } catch {
      // silently ignore; user can retry by re-selecting the tab
    }
  }

  async function matchRows() {
    setMatchLoading(true);
    setMatchErr(null);
    setMatched([]);
    setSelected(new Set());
    try {
      const r = await fetch("/api/studio/batch/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId, tab, mapping, folderId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "match failed");
      setMatched(d.rows ?? []);
    } catch (e) {
      setMatchErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMatchLoading(false);
    }
  }

  function toggleRow(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      const selectableIndices = matched
        .map((_, i) => i)
        .filter((i) => matched[i].match.status === "matched");
      setSelected(new Set(selectableIndices));
    } else {
      setSelected(new Set());
    }
  }

  const selectableIndices = matched
    .map((_, i) => i)
    .filter((i) => matched[i].match.status === "matched");
  const allSelected =
    selectableIndices.length > 0 &&
    selectableIndices.every((i) => selected.has(i));

  const canMatch = !!(spreadsheetId && tab && mapping.name != null && folderId);

  // Google not connected
  if (connected === false) {
    return (
      <div className="card mt-8">
        <p className="text-muted">
          Connect your Google account to read Drive folders and sheets.
        </p>
        <a className="btn btn-accent mt-4 inline-flex" href="/api/google/auth">
          Connect Google
        </a>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {/* Step 1: Sheet source */}
      <div className="card">
        <p className="eyebrow">Step 1: sheet</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2"
            placeholder="Google Sheet URL or spreadsheet ID"
            value={spreadsheetInput}
            onChange={(e) => setSpreadsheetInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") loadTabs(); }}
          />
          <button
            className="btn"
            onClick={loadTabs}
            disabled={tabsLoading || !spreadsheetInput.trim()}
          >
            {tabsLoading ? "Loading..." : "Load tabs"}
          </button>
        </div>

        {tabError === "google" && (
          <p className="mt-3 text-sm text-muted">
            Google is not connected.{" "}
            <a className="underline" href="/settings">Connect it in settings</a>.
          </p>
        )}
        {tabError === "sheets" && (
          <p className="mt-3 text-sm text-muted">
            Sheets access is missing. Re-authorise Google to include Sheets.{" "}
            <a className="underline" href="/api/google/auth">Re-authorise</a>.
          </p>
        )}

        {tabs.length > 0 && (
          <div className="mt-5 flex flex-col gap-5">
            <label className="block">
              <span className="eyebrow">Tab</span>
              <select
                className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
                value={tab}
                onChange={(e) => loadValues(e.target.value)}
              >
                <option value="">Choose a tab</option>
                {tabs.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>

            {header.length > 0 && (
              <div>
                <p className="eyebrow">Column mapping</p>
                <div className="mt-2 flex flex-wrap gap-4">
                  {/* Name (required) */}
                  <label className="block">
                    <span className="text-xs text-muted">Name column</span>
                    <select
                      className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
                      value={mapping.name ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m,
                          name: e.target.value === "" ? null : Number(e.target.value),
                        }))
                      }
                    >
                      <option value="">Choose a column</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>{h}</option>
                      ))}
                    </select>
                  </label>

                  {/* Title (optional) */}
                  <label className="block">
                    <span className="text-xs text-muted">Title column</span>
                    <select
                      className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
                      value={mapping.title ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m,
                          title: e.target.value === "" ? null : Number(e.target.value),
                        }))
                      }
                    >
                      <option value="">None</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>{h}</option>
                      ))}
                    </select>
                  </label>

                  {/* Photo (optional) */}
                  <label className="block">
                    <span className="text-xs text-muted">Photo column</span>
                    <select
                      className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
                      value={mapping.photo ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m,
                          photo: e.target.value === "" ? null : Number(e.target.value),
                        }))
                      }
                    >
                      <option value="">None</option>
                      {header.map((h, i) => (
                        <option key={i} value={i}>{h}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {rows.length} {rows.length === 1 ? "row" : "rows"} found.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step 2: Renderer */}
      <div className="card">
        <p className="eyebrow">Step 2: renderer</p>
        <div className="mt-3 inline-flex rounded-lg border border-line p-1">
          {(["local", "canva"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRenderer(r)}
              className={`rounded-md px-4 py-1.5 text-sm ${
                renderer === r ? "bg-accent text-white" : "text-muted"
              }`}
            >
              {r === "local" ? "Local" : "Canva"}
            </button>
          ))}
        </div>

        {renderer === "local" && (
          <div className="mt-4 flex flex-wrap gap-3">
            {FRAME_LIST.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStyleId(f.id)}
                className={`btn ${styleId === f.id ? "btn-accent" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {renderer === "canva" && canvaConnected === false && (
          <p className="mt-4 text-sm text-muted">
            Canva is not connected.{" "}
            <a className="underline" href="/settings">Connect it in settings</a>.
          </p>
        )}

        {renderer === "canva" && canvaConnected && (
          <label className="mt-4 block">
            <span className="eyebrow">Brand template</span>
            <select
              className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
              value={styleId}
              onChange={(e) => setStyleId(e.target.value)}
            >
              <option value="">Select a template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Step 3: Photo folder */}
      <div className="card">
        <p className="eyebrow">Step 3: photo folder</p>
        <select
          className="mt-3 block rounded-lg border border-line bg-surface px-3 py-2"
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
        >
          <option value="">Choose a folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>

      {/* Step 4: Match */}
      <div className="card">
        <p className="eyebrow">Step 4: match rows</p>
        <button
          className="btn btn-accent mt-3"
          onClick={matchRows}
          disabled={matchLoading || !canMatch}
        >
          {matchLoading ? "Matching..." : "Match rows"}
        </button>
        {!canMatch && matched.length === 0 && (
          <p className="mt-2 text-sm text-muted">
            Load a sheet, pick a tab, set the name column, and choose a photo folder first.
          </p>
        )}
        {matchErr && <p className="mt-3 text-sm text-danger">{matchErr}</p>}

        {matched.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="pb-2 pr-4 font-medium">
                    <label className="flex items-center gap-1.5">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleAll(e.target.checked)}
                      />
                      <span className="text-xs text-muted">All</span>
                    </label>
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted">Name</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-muted">Title</th>
                  <th className="pb-2 text-xs font-medium text-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((row, i) => {
                  const isMatchable = row.match.status === "matched";
                  return (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-4">
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          disabled={!isMatchable}
                          onChange={() => toggleRow(i)}
                        />
                      </td>
                      <td className="py-2.5 pr-4 font-medium">{row.name}</td>
                      <td className="py-2.5 pr-4 text-muted">{row.title}</td>
                      <td className="py-2.5">
                        <StatusChip status={row.match.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {selected.size > 0 && (
              <p className="mt-3 text-sm text-muted">
                {selected.size} {selected.size === 1 ? "row" : "rows"} selected.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
