"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { kindsFor } from "@/lib/workflow/compat";

interface WorkflowListItem {
  id: string;
  name: string;
  steps: { toolId: string; params: Record<string, unknown> }[];
  updatedAt: number;
}

type RunPromptKind = "file" | "url-text";

interface RunPrompt {
  workflowId: string;
  kind: RunPromptKind;
}

interface RunStatus {
  runId?: string;
  error?: string;
}

export function WorkflowsClient() {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<RunPrompt | null>(null);
  const [urlValue, setUrlValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<Record<string, RunStatus>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    const res = await fetch("/api/workflow");
    const body = await res.json();
    setWorkflows(body.workflows ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  async function postRun(id: string, firstInput: unknown) {
    setBusyId(id);
    setRunStatus((prev) => ({ ...prev, [id]: {} }));
    try {
      const res = await fetch(`/api/workflow/${id}/run`, {
        method: "POST",
        body: JSON.stringify({ firstInput }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not start the run.");
      setRunStatus((prev) => ({ ...prev, [id]: { runId: body.runId } }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not start the run.";
      setRunStatus((prev) => ({ ...prev, [id]: { error: message } }));
    } finally {
      setBusyId(null);
      setPrompt(null);
      setUrlValue("");
    }
  }

  // "Run" needs a real firstInput for the workflow's first step, matching
  // whatever shape that step's adapter expects (lib/workflow/steps/*). A
  // saved chain never carries that value itself: file/url-text steps
  // consume it fresh each run, so we prompt for it here rather than
  // replaying a stale or null input.
  function onRunClick(w: WorkflowListItem) {
    const first = w.steps[0];
    const kinds = first ? kindsFor(first.toolId) : undefined;
    // Allowlist: only these two inputKinds have a matching prompt UI below.
    // Everything else (e.g. "none" for sorter/studio, "files" for splice's
    // multi-clip input) is disabled rather than falling through to a
    // mismatched prompt — see runDisabled below, which mirrors this check.
    if (!kinds || (kinds.inputKind !== "file" && kinds.inputKind !== "url-text")) return; // disabled in the UI, no-op
    if (kinds.inputKind === "file") {
      setPrompt({ workflowId: w.id, kind: "file" });
      // Defer to next tick so the (now-rendered) hidden input exists before we click it.
      requestAnimationFrame(() => fileInputRef.current?.click());
    } else {
      setPrompt({ workflowId: w.id, kind: "url-text" });
    }
  }

  async function onFileChosen(workflowId: string, file: File | undefined) {
    if (!file) {
      setPrompt(null);
      return;
    }
    setBusyId(workflowId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/workflow/upload", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Upload failed.");
      await postRun(workflowId, { path: body.path, filename: body.filename });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed.";
      setRunStatus((prev) => ({ ...prev, [workflowId]: { error: message } }));
      setBusyId(null);
      setPrompt(null);
    }
  }

  function submitUrl(workflowId: string) {
    const text = urlValue.trim();
    if (!text) return;
    postRun(workflowId, { text });
  }

  async function deleteOne(id: string) {
    await fetch(`/api/workflow/${id}`, { method: "DELETE" });
    setConfirmingId(null);
    load();
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="text-lg font-semibold">Saved workflows</h1>
      {workflows.length === 0 && <p className="mt-3 text-sm text-muted">No saved workflows yet.</p>}
      <ul className="mt-3 divide-y divide-line/60">
        {workflows.map((w) => {
          const first = w.steps[0];
          const kinds = first ? kindsFor(first.toolId) : undefined;
          // Allowlist, matching onRunClick: only "file" and "url-text" have a
          // prompt UI below. Any other inputKind (including "none" for
          // sorter/studio and "files" for splice's multi-clip input) disables Run.
          const runDisabled = !kinds || (kinds.inputKind !== "file" && kinds.inputKind !== "url-text");
          const status = runStatus[w.id];
          const isBusy = busyId === w.id;
          const isPrompting = prompt?.workflowId === w.id;

          return (
            <li key={w.id} className="py-3">
              <p className="text-sm font-medium">{w.name}</p>
              <p className="text-xs text-muted">{w.steps.map((s) => s.toolId).join(" → ")}</p>

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <button
                  type="button"
                  className="underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => onRunClick(w)}
                  disabled={runDisabled || isBusy}
                >
                  {isBusy ? "Running…" : "Run"}
                </button>
                <Link className="underline underline-offset-2" href={`/workflow?load=${w.id}`}>
                  Edit
                </Link>
                {confirmingId === w.id ? (
                  <span className="flex items-center gap-2">
                    <span className="text-danger">Delete?</span>
                    <button type="button" className="underline underline-offset-2" onClick={() => deleteOne(w.id)}>
                      Yes
                    </button>
                    <button type="button" className="underline underline-offset-2" onClick={() => setConfirmingId(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-danger underline underline-offset-2"
                    onClick={() => setConfirmingId(w.id)}
                  >
                    Delete
                  </button>
                )}
              </div>

              {runDisabled && (
                <p className="mt-2 text-xs text-muted">
                  Re-running this workflow from a saved chain isn&apos;t supported yet (its first step doesn&apos;t take a
                  single file or link as input). Build a new one from{" "}
                  <Link className="underline underline-offset-2" href="/workflow">
                    /workflow
                  </Link>{" "}
                  instead.
                </p>
              )}

              {isPrompting && prompt?.kind === "file" && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="text-xs"
                    onChange={(e) => onFileChosen(w.id, e.target.files?.[0])}
                  />
                  <button type="button" className="underline underline-offset-2" onClick={() => setPrompt(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {isPrompting && prompt?.kind === "url-text" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <input
                    type="text"
                    autoFocus
                    className="field min-h-[32px] w-full max-w-xs px-2 py-1 text-xs"
                    placeholder="https://…"
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitUrl(w.id);
                      if (e.key === "Escape") setPrompt(null);
                    }}
                  />
                  <button
                    type="button"
                    className="underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => submitUrl(w.id)}
                    disabled={!urlValue.trim()}
                  >
                    Go
                  </button>
                  <button type="button" className="underline underline-offset-2" onClick={() => setPrompt(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {isBusy && (
                <p className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} /> Working…
                </p>
              )}
              {status?.runId && <p className="mt-2 text-xs text-muted">Run started: {status.runId}</p>}
              {status?.error && <p className="mt-2 text-xs text-danger">{status.error}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
