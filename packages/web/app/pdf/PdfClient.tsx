"use client";
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, Loader2, X } from "lucide-react";
import { Segmented } from "@/components/Segmented";

type Mode = "merge" | "split" | "compress";
interface Result { id: string; filename: string; kind: "pdf" | "zip" }
interface Picked { key: string; file: File }

export function PdfClient() {
  const mergeFileRef = useRef<HTMLInputElement | null>(null);
  const singleFileRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<Mode>("merge");
  const [mergeFiles, setMergeFiles] = useState<Picked[]>([]);
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [ranges, setRanges] = useState("");
  const [single, setSingle] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function resetOutcome() {
    setError(null);
    setResult(null);
  }

  function switchMode(next: Mode) {
    setMode(next);
    resetOutcome();
    // Each mode gets its own file input; clear the picked file(s) so state
    // can't outlive the unmounted input that produced it.
    setMergeFiles([]);
    setSingleFile(null);
    setRanges("");
    setSingle(false);
    if (mergeFileRef.current) mergeFileRef.current.value = "";
    if (singleFileRef.current) singleFileRef.current.value = "";
  }

  function onPickMergeFiles() {
    const files = mergeFileRef.current?.files;
    if (!files || files.length === 0) return;
    const next: Picked[] = Array.from(files).map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, file: f }));
    setMergeFiles(next);
    resetOutcome();
  }

  function moveMergeFile(index: number, dir: -1 | 1) {
    setMergeFiles((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeMergeFile(key: string) {
    setMergeFiles((prev) => prev.filter((p) => p.key !== key));
  }

  function onPickSingleFile() {
    const f = singleFileRef.current?.files?.[0];
    setSingleFile(f ?? null);
    resetOutcome();
  }

  const canSubmit =
    !busy &&
    (mode === "merge" ? mergeFiles.length > 0 : mode === "split" ? !!singleFile && ranges.trim().length > 0 : !!singleFile);

  async function submit() {
    resetOutcome();
    setBusy(true);
    try {
      const fd = new FormData();
      if (mode === "merge") {
        for (const p of mergeFiles) fd.append("file", p.file);
      } else if (mode === "split") {
        if (!singleFile) throw new Error("Choose a PDF first.");
        fd.append("file", singleFile);
        fd.append("ranges", ranges);
        fd.append("single", String(single));
      } else {
        if (!singleFile) throw new Error("Choose a PDF first.");
        fd.append("file", singleFile);
      }
      const r = await fetch(`/api/pdf/process/${mode}`, { method: "POST", body: fd });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.id) throw new Error(data?.error ?? "That didn't work.");
      setResult({ id: data.id, filename: data.filename, kind: data.kind === "zip" ? "zip" : "pdf" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-5">
      <div className="card">
        <Segmented
          options={[
            { value: "merge", label: "Merge" },
            { value: "split", label: "Split" },
            { value: "compress", label: "Compress" },
          ]}
          value={mode}
          onChange={(v) => switchMode(v as Mode)}
        />

        {mode === "merge" && (
          <div className="mt-4">
            <label className="block text-sm font-medium">PDFs to merge
              <input
                ref={mergeFileRef}
                type="file"
                multiple
                accept="application/pdf"
                onChange={onPickMergeFiles}
                className="field mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-ink"
              />
            </label>
            <p className="mt-1 text-sm text-muted">Pages are combined in this order. Use the arrows to reorder.</p>

            {mergeFiles.length > 0 && (
              <ul className="mt-3 space-y-2">
                {mergeFiles.map((p, i) => (
                  <li key={p.key} className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2 shadow-raisededge">
                    <span className="flex-1 truncate text-sm">{p.file.name}</span>
                    <button
                      type="button"
                      onClick={() => moveMergeFile(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="text-muted hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <ArrowUp className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveMergeFile(i, 1)}
                      disabled={i === mergeFiles.length - 1}
                      aria-label="Move down"
                      className="text-muted hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <ArrowDown className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMergeFile(p.key)}
                      aria-label="Remove"
                      className="text-muted hover:text-ink"
                    >
                      <X className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mode === "split" && (
          <div className="mt-4 space-y-4">
            <label className="block text-sm font-medium">PDF to split
              <input
                ref={singleFileRef}
                type="file"
                accept="application/pdf"
                onChange={onPickSingleFile}
                className="field mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-ink"
              />
            </label>
            <label className="block text-sm font-medium">Pages
              <input
                className="field mt-1"
                placeholder="1-3, 5, 8-10"
                value={ranges}
                onChange={(e) => { setRanges(e.target.value); resetOutcome(); }}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={single}
                onChange={(e) => setSingle(e.target.checked)}
              />
              Combine into one PDF instead of separate files
            </label>
          </div>
        )}

        {mode === "compress" && (
          <div className="mt-4">
            <label className="block text-sm font-medium">PDF to compress
              <input
                ref={singleFileRef}
                type="file"
                accept="application/pdf"
                onChange={onPickSingleFile}
                className="field mt-1 file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1 file:text-ink"
              />
            </label>
            <p className="mt-1 text-sm text-muted">Tidies the file structure. It won't shrink image-heavy PDFs.</p>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="btn btn-accent" onClick={submit} disabled={!canSubmit}>
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} /> Working…</> : "Run"}
          </button>
          {busy && <span className="text-sm text-muted">Working…</span>}
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {result && (
        <div className="card">
          <p className="eyebrow">Ready</p>
          <p className="mt-1 text-sm">{result.filename}</p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a
              className="btn inline-flex items-center gap-2"
              href={`/api/pdf/file/${result.id}?name=${encodeURIComponent(result.filename)}&kind=${result.kind}`}
              download
            >
              <Download className="w-4 h-4" strokeWidth={1.75} /> Download
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
