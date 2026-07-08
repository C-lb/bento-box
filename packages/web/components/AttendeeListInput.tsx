"use client";
import { useEffect, useRef, useState } from "react";
import { Segmented } from "@/components/Segmented";
import { FileDrop } from "@/components/FileDrop";
import { parseDelimited, type Rows } from "@event-editor/core/merge";
import { parseWorkbook } from "@/lib/merge-xlsx";

type Source = "paste" | "upload" | "sheet";

export function AttendeeListInput({ onRows }: { onRows: (r: Rows) => void }) {
  const [source, setSource] = useState<Source>("paste");
  const [pasteText, setPasteText] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  function emit(r: Rows) { setCount(r.rows.length); onRows(r); }

  useEffect(() => {
    if (source === "paste") emit(parseDelimited(pasteText));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, pasteText]);

  async function onUpload(file: File) {
    setError(null);
    try { emit(parseWorkbook(await file.arrayBuffer())); }
    catch { setError("Could not read that file. Use a .csv or .xlsx export."); }
  }

  async function loadSheet() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/sheet", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sheetUrl }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not load that sheet."); return; }
      emit(data);
    } catch { setError("Could not load that sheet."); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <p className="text-sm font-medium">Attendee list</p>
      <div className="mt-2">
        <Segmented
          options={[
            { value: "paste", label: "Paste" },
            { value: "upload", label: "Upload CSV" },
            { value: "sheet", label: "Google Sheet" },
          ]}
          value={source}
          onChange={(v) => setSource(v as Source)}
        />
      </div>
      {source === "paste" && (
        <textarea className="field mt-3 h-32 w-full" placeholder="One name per line, or paste columns from a spreadsheet"
          value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
      )}
      {source === "upload" && (
        <div className="mt-3">
          <FileDrop inputRef={fileRef} accept=".csv,.xlsx" label="Drop a CSV or XLSX here, or click to browse"
            onChange={(has) => { if (has && fileRef.current?.files?.[0]) onUpload(fileRef.current.files[0]); }} />
        </div>
      )}
      {source === "sheet" && (
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <input className="field flex-1 min-h-[44px] sm:min-h-0" placeholder="Paste a Google Sheet link" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
          <button className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={loadSheet} disabled={busy || !sheetUrl}>Load</button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-2 text-sm text-muted">{count} {count === 1 ? "row" : "rows"} loaded</p>
    </div>
  );
}
