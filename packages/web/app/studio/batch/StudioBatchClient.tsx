"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FRAME_LIST, type HeadshotStyle } from "@event-editor/core/frames";
import { detectColumns } from "@event-editor/core/columns";
import { StatusBadge } from "@/components/StatusBadge";
import { headshotStatusView } from "@/lib/status";
import { usePollWhileVisible } from "@/lib/use-visible-poll";
import { FolderPicker, type PickedFolder } from "@/components/FolderPicker";
import { PresetBar } from "../PresetBar";
import { PastBatches } from "./PastBatches";
import type { HeadshotPreset } from "@/lib/headshot-presets";

type MatchStatus = "matched" | "ambiguous" | "unmatched";
interface RowMatch { status: MatchStatus; driveFileId?: string; candidates?: string[]; }
interface MatchedRow { index: number; name: string; title: string; match: RowMatch; }
type Mapping = { name: number | null; title: number | null; photo: number | null };
export interface BatchHeadshot { id: number; status: string; imageUrl: string | null; errorMessage: string | null; nameText: string; }
interface SubmittedRow { driveFileId: string; nameText: string; titleText: string; }

/** True once every row has reached a terminal state; gates the status poll. */
export function isBatchSettled(headshots: BatchHeadshot[]): boolean {
  return headshots.length > 0 && headshots.every((h) => h.status === "done" || h.status === "error");
}

/** Optimistic local transition for a row retry. Flipping the row back to
 *  pending makes isBatchSettled false again, which re-arms the visibility
 *  poll; without it, a retry on a fully settled batch would never refetch
 *  (the poll's `active` gate stays false and the pollKey bump re-runs an
 *  effect that early-returns). */
export function applyRetry(headshots: BatchHeadshot[], id: number): BatchHeadshot[] {
  return headshots.map((h) => (h.id === id ? { ...h, status: "pending", errorMessage: null } : h));
}

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
  const [presetStyle, setPresetStyle] = useState<HeadshotStyle | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  // Folder
  const [folder, setFolder] = useState<PickedFolder | null>(null);
  const folderId = folder?.id ?? "";

  // Match
  const [matchLoading, setMatchLoading] = useState(false);
  const [matched, setMatched] = useState<MatchedRow[]>([]);
  const [matchErr, setMatchErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Batch / generate
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchHeadshots, setBatchHeadshots] = useState<BatchHeadshot[]>([]);
  const [submittedRows, setSubmittedRows] = useState<SubmittedRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateErr, setGenerateErr] = useState<string | null>(null);
  const [pollKey, setPollKey] = useState(0);

  const selectAllRef = useRef<HTMLInputElement>(null);

  // Probe for the Google connection on mount; the FolderPicker lists on demand.
  useEffect(() => {
    fetch("/api/drive/folders?parent=root").then((r) => setConnected(r.status !== 401)).catch(() => setConnected(false));
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

  // Reset styleId (and any applied preset) when renderer changes
  useEffect(() => {
    if (renderer === "local") setStyleId(FRAME_LIST[0]?.id ?? "");
    else setStyleId("");
    setPresetStyle(null);
    setActivePresetId(null);
  }, [renderer]);

  function applyBatchPreset(p: HeadshotPreset) {
    setStyleId(p.frameId);
    setPresetStyle(p.style);
    setActivePresetId(p.id);
  }

  function pickFrame(id: string) {
    setStyleId(id);
    setPresetStyle(null);
    setActivePresetId(null);
  }

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

  // Poll batch status while batchId is set; stop when every row is done or error
  const batchSettled = isBatchSettled(batchHeadshots);
  // Stable callback: usePollWhileVisible re-arms its interval whenever `fn`
  // changes identity, so this must be memoized (see transcribe/TranscribeClient).
  const pollTick = useCallback(() => {
    if (!batchId) return;
    (async () => {
      try {
        const r = await fetch(`/api/studio/batch/${batchId}`);
        if (!r.ok) return;
        const d = await r.json();
        setBatchHeadshots(d.headshots ?? []);
      } catch {
        // continue on transient network error
      }
    })();
    // pollKey forces a one-off refetch (e.g. after a row retry) without
    // otherwise affecting the interval's cadence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, pollKey]);
  usePollWhileVisible(pollTick, 1500, !!batchId && !batchSettled);

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

  async function generate() {
    setGenerating(true);
    setGenerateErr(null);
    const submitRows: SubmittedRow[] = [...selected]
      .sort((a, b) => a - b)
      .map((i) => matched[i])
      .map((r) => ({
        driveFileId: r.match.driveFileId!,
        nameText: r.name,
        titleText: r.title,
      }));
    try {
      const r = await fetch("/api/studio/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renderer, styleId, rows: submitRows, ...(presetStyle ? { style: presetStyle } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "failed to start batch");
      setSubmittedRows(submitRows);
      setBatchHeadshots([]);
      setBatchId(d.batchId);
    } catch (e) {
      setGenerateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function retryRow(id: number) {
    await fetch(`/api/studio/batch/${batchId}/retry/${id}`, { method: "POST" });
    // Optimistic pending transition re-arms the settled poll (see applyRetry);
    // the pollKey bump forces an immediate refetch on a still-running batch.
    setBatchHeadshots((prev) => applyRetry(prev, id));
    setPollKey((k) => k + 1);
  }

  function startOver() {
    setBatchId(null);
    setBatchHeadshots([]);
    setSubmittedRows([]);
    setMatched([]);
    setSelected(new Set());
    setGenerateErr(null);
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
  const canGenerate = selected.size > 0 && !!styleId && !generating && !batchId;
  const generateDisabledReason =
    batchId
      ? null
      : selected.size === 0 && !styleId
      ? "Select rows and a style first."
      : selected.size === 0
      ? "Select at least one matched row."
      : !styleId
      ? "Choose a style first."
      : null;

  // Google not connected
  if (connected === false) {
    return (
      <div className="card mt-8">
        <p className="text-muted">
          Connect your Google account to read Drive folders and sheets.
        </p>
        <a className="btn btn-accent mt-4 min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center inline-flex items-center" href="/api/google/auth">
          Connect Google
        </a>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <div className="flex justify-end">
        <PastBatches />
      </div>

      {/* Step 1: Sheet source */}
      <div className="card">
        <p className="eyebrow">Step 1: sheet</p>
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <input
            className="field min-w-0 flex-1 min-h-[44px] sm:min-h-0"
            placeholder="Google Sheet URL or spreadsheet ID"
            value={spreadsheetInput}
            onChange={(e) => setSpreadsheetInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") loadTabs(); }}
          />
          <button
            className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
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
                className="field mt-1 block w-full sm:w-auto min-h-[44px] sm:min-h-0"
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
                <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
                  {/* Name (required) */}
                  <label className="block">
                    <span className="text-xs text-muted">Name column</span>
                    <select
                      className="field mt-1 block w-full sm:w-auto min-h-[44px] sm:min-h-0"
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
                      className="field mt-1 block w-full sm:w-auto min-h-[44px] sm:min-h-0"
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
                      className="field mt-1 block w-full sm:w-auto min-h-[44px] sm:min-h-0"
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
              className={`min-h-[44px] sm:min-h-0 rounded-md px-4 py-1.5 text-sm ${
                renderer === r ? "bg-accent text-white" : "text-muted"
              }`}
            >
              {r === "local" ? "Local" : "Canva"}
            </button>
          ))}
        </div>

        {renderer === "local" && (
          <div className="mt-4 flex flex-col gap-5">
            <div className="flex flex-wrap gap-3">
              {FRAME_LIST.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => pickFrame(f.id)}
                  className={`btn min-h-[44px] sm:min-h-0 ${styleId === f.id && !activePresetId ? "btn-accent" : ""}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <PresetBar frameId={styleId} style={presetStyle ?? {}} manage={false} activeId={activePresetId} onApply={applyBatchPreset} />
            {activePresetId && (
              <p className="text-sm text-muted">Preset applied to every generated card. Pick a frame above to clear it.</p>
            )}
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
              className="field mt-1 block w-full sm:w-auto min-h-[44px] sm:min-h-0"
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
        <div className="mt-3">
          <FolderPicker value={folder} onChange={setFolder} />
        </div>
      </div>

      {/* Step 4: Match */}
      <div className="card">
        <p className="eyebrow">Step 4: match rows</p>
        <button
          className="btn btn-accent mt-3 min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
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
                    <label className="flex items-center gap-1.5 py-1">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleAll(e.target.checked)}
                        className="h-[18px] w-[18px]"
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
                          className="h-[18px] w-[18px]"
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

      {/* Step 5: Generate */}
      <div className="card">
        <p className="eyebrow">Step 5: generate</p>
        <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
          <button
            className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
            onClick={generate}
            disabled={!canGenerate}
          >
            {generating
              ? "Starting..."
              : `Generate ${selected.size} headshot${selected.size !== 1 ? "s" : ""}`}
          </button>
          {batchId && (
            <button className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={startOver}>
              Start over
            </button>
          )}
        </div>
        {generateDisabledReason && (
          <p className="mt-2 text-sm text-muted">{generateDisabledReason}</p>
        )}
        {generateErr && (
          <p className="mt-3 text-sm text-danger">{generateErr}</p>
        )}
      </div>

      {/* Results */}
      {batchId && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="eyebrow">Results</p>
            <button className="btn min-h-[44px] sm:min-h-0" onClick={startOver}>
              Start over
            </button>
          </div>
          {batchHeadshots.some((r) => r.status === "done") && (
            <a
              className="btn btn-accent mt-4 min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center inline-flex items-center"
              href={`/api/studio/batch/${batchId}/zip`}
              download={`batch-${batchId}.zip`}
            >
              Download all
            </a>
          )}
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {batchHeadshots.length > 0
              ? batchHeadshots.map((hs) => {
                  return (
                    <div key={hs.id} className="overflow-hidden rounded-lg border border-line">
                      {hs.status === "done" && hs.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={hs.imageUrl}
                          alt={hs.nameText ?? "headshot"}
                          className="aspect-square w-full object-cover"
                        />
                      ) : (
                        <div className="aspect-square w-full bg-raised" />
                      )}
                      <div className="flex flex-col gap-2 p-3">
                        <p className="text-sm font-medium">{hs.nameText}</p>
                        <StatusBadge {...headshotStatusView(hs.status)} />
                        {hs.status === "error" && (
                          <>
                            <p className="text-xs text-danger">
                              {hs.errorMessage ?? "Something went wrong."}
                            </p>
                            <button
                              className="btn min-h-[44px] sm:min-h-0 w-full justify-center"
                              onClick={() => retryRow(hs.id)}
                            >
                              Retry
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              : submittedRows.map((row, i) => (
                  <div key={i} className="overflow-hidden rounded-lg border border-line">
                    <div className="aspect-square w-full bg-raised" />
                    <div className="flex flex-col gap-2 p-3">
                      <p className="text-sm font-medium">{row.nameText}</p>
                      <StatusBadge {...headshotStatusView("pending")} />
                    </div>
                  </div>
                ))
            }
          </div>
        </div>
      )}
    </div>
  );
}
