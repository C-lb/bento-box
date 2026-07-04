"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { FileDrop } from "@/components/FileDrop";
import {
  parseDelimited, autoMatchColumns, deriveFields, type Rows,
} from "@event-editor/core/merge";
import { certificateSpec, CERTIFICATE_LAYOUTS, type CertificateLayout } from "@event-editor/core/certificate";
import { parseWorkbook } from "@/lib/merge-xlsx";
import { renderCombined, renderZip, loadBundledFonts, type FontBytes } from "@/lib/merge-render";

type Source = "paste" | "upload" | "sheet";

export function CertificateClient() {
  const [source, setSource] = useState<Source>("paste");
  const [rows, setRows] = useState<Rows>({ headers: [], rows: [] });
  const [pasteText, setPasteText] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [layout, setLayout] = useState<CertificateLayout>("classic");
  const [title, setTitle] = useState("Certificate of completion");
  const [bodyLine, setBodyLine] = useState("This certifies that");
  const [detailLine, setDetailLine] = useState("has completed the workshop");
  const [dateText, setDateText] = useState("");
  const [signatureName, setSignatureName] = useState("SPARK");
  const [recipientField, setRecipientField] = useState("Name");

  // keep pasted rows live
  useEffect(() => {
    if (source === "paste") setRows(parseDelimited(pasteText));
  }, [source, pasteText]);

  const spec = useMemo(() => certificateSpec({
    layout, title, bodyLine, recipientField, detailLine, dateText,
    signatureName: signatureName || undefined,
  }), [layout, title, bodyLine, recipientField, detailLine, dateText, signatureName]);

  const fields = useMemo(() => deriveFields(spec), [spec]);
  const mapping = useMemo(() => autoMatchColumns(fields, rows.headers), [fields, rows.headers]);
  const recipientColumn = mapping[recipientField] ?? recipientField;

  // remap headers so the spec's {recipientField} token resolves against the picked column
  const mergedRows = useMemo(
    () => rows.rows.map((r) => ({ ...r, [recipientField]: r[recipientColumn] ?? r[recipientField] ?? "" })),
    [rows.rows, recipientField, recipientColumn],
  );

  async function download(kind: "combined" | "zip") {
    setBusy(true); setError(null);
    try {
      let fonts: FontBytes | undefined;
      try { fonts = await loadBundledFonts(); } catch { fonts = undefined; }
      if (kind === "combined") {
        const bytes = await renderCombined(spec, mergedRows, fonts);
        triggerDownload(new Blob([bytes as BlobPart], { type: "application/pdf" }), "certificates.pdf");
      } else {
        const blob = await renderZip(spec, mergedRows, recipientField, fonts);
        triggerDownload(blob, "certificates.zip");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function onUpload(file: File) {
    setError(null);
    try { setRows(parseWorkbook(await file.arrayBuffer())); }
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
      setRows(data);
    } catch { setError("Could not load that sheet."); }
    finally { setBusy(false); }
  }

  const count = mergedRows.length;
  const ready = count > 0 && !!recipientColumn;

  return (
    <div className="mt-8 space-y-5">
      {/* 1. list source */}
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
          <textarea
            className="field mt-3 h-32 w-full"
            placeholder={"One name per line, or paste columns from a spreadsheet"}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
        )}
        {source === "upload" && (
          <div className="mt-3">
            <FileDrop
              inputRef={fileRef}
              accept=".csv,.xlsx"
              label="Drop a CSV or XLSX here, or click to browse"
              onChange={(has) => { if (has && fileRef.current?.files?.[0]) onUpload(fileRef.current.files[0]); }}
            />
          </div>
        )}
        {source === "sheet" && (
          <div className="mt-3 flex gap-2">
            <input className="field flex-1" placeholder="Paste a Google Sheet link"
              value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
            <button className="btn" onClick={loadSheet} disabled={busy || !sheetUrl}>Load</button>
          </div>
        )}
        <p className="mt-2 text-sm text-muted">{count} {count === 1 ? "row" : "rows"} loaded</p>
      </div>

      {/* 2. layout + copy */}
      <div className="card space-y-3">
        <p className="text-sm font-medium">Design</p>
        <Segmented
          options={CERTIFICATE_LAYOUTS.map((l) => ({ value: l.id, label: l.label }))}
          value={layout}
          onChange={(v) => setLayout(v as CertificateLayout)}
        />
        <LabeledInput label="Title" value={title} onChange={setTitle} />
        <LabeledInput label="Body line" value={bodyLine} onChange={setBodyLine} />
        <LabeledInput label="Detail line" value={detailLine} onChange={setDetailLine} />
        <LabeledInput label="Date" value={dateText} onChange={setDateText} />
        <LabeledInput label="Signature" value={signatureName} onChange={setSignatureName} />
        <LabeledInput label="Recipient column" value={recipientField} onChange={setRecipientField} />
        {rows.headers.length > 0 && !rows.headers.includes(recipientColumn) && (
          <p className="text-sm text-amber-600">
            No "{recipientField}" column found. Available: {rows.headers.join(", ")}.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* 3. output */}
      <div className="card flex flex-wrap gap-3">
        <button className="btn btn-accent inline-flex items-center gap-2"
          onClick={() => download("combined")} disabled={!ready || busy}>
          <Download className="w-4 h-4" strokeWidth={1.75} /> Combined PDF
        </button>
        <button className="btn inline-flex items-center gap-2"
          onClick={() => download("zip")} disabled={!ready || busy}>
          <Download className="w-4 h-4" strokeWidth={1.75} /> Zip of files
        </button>
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium">{label}
      <input className="field mt-1 w-full" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
