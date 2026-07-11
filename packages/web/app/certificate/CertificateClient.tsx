"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { FileDrop } from "@/components/FileDrop";
import {
  parseDelimited, autoMatchColumns, deriveFields, remapRows, type Rows,
} from "@event-editor/core/merge";
import { certificateSpec, CERTIFICATE_LAYOUTS, type CertificateLayout } from "@event-editor/core/certificate";
import { applyDesign, type DesignOverrides } from "@event-editor/core/design";
import { parseWorkbook } from "@/lib/merge-xlsx";
import { renderCombined, renderZip, type FontBytes } from "@/lib/merge-render";
import { MergePreview } from "@/components/MergePreview";
import { DesignPanel, type SizePreset } from "@/components/DesignPanel";
import { loadDesign, saveDesign } from "@/components/design-store";
import { CUSTOM_LAYOUT_ID } from "@/components/MergeToolClient";
import { CustomDesignEditor } from "@/components/CustomDesignEditor";
import { loadCustomDesign, saveCustomDesign } from "@/components/custom-design-store";
import { getAsset } from "@/lib/design-assets";
import { assetSrc } from "@/lib/custom-upload";
import { customDesignToSpec, type CustomDesign } from "@event-editor/core/custom-design";
import { addUploadedFont, listUploadedFonts } from "@/lib/designer-fonts";
import { designSlots, specFontIds, withDesignFonts, EMPTY_ROW } from "@/lib/design-tools";

type Source = "paste" | "upload" | "sheet";

const TOOL_ID = "certificate";

// The certificate's copy fields aren't spreadsheet-merge tokens in the
// built-in layouts (they're typed straight into the spec), but in Custom
// mode they become droppable `{key}` field elements just like the shared
// MergeToolClient's copyFields. Recipient uses the same default as the
// built-in "Name" column.
const CERTIFICATE_CUSTOM_FIELDS = [
  { key: "title", label: "Title" },
  { key: "bodyLine", label: "Body line" },
  { key: "detailLine", label: "Detail line" },
  { key: "dateText", label: "Date" },
  { key: "signatureName", label: "Signature" },
];

// Matches the recipientField useState default below; the recipient field
// element dropped on the Custom canvas always uses this fixed token, exactly
// like MergeToolClient's `config.recipientDefault`. The recipient input only
// picks a column *name* — `mergedRows` (via `remapRows`) is what actually
// maps that column's values onto this fixed token for rendering.
const CERTIFICATE_RECIPIENT_DEFAULT = "Name";

const EMPTY_CUSTOM: CustomDesign = {
  v: 1,
  page: { width: 841.89, height: 595.28 }, // A4 landscape default until a background sets the size
  background: null,
  elements: [],
};

const SIZE_PRESETS: SizePreset[] = [
  { id: "a4-landscape", label: "A4 landscape", width: 841.89, height: 595.28 },
  { id: "a4-portrait", label: "A4 portrait", width: 595.28, height: 841.89 },
  { id: "a5-landscape", label: "A5 landscape", width: 595.28, height: 419.53 },
  { id: "us-letter-landscape", label: "US Letter landscape", width: 792, height: 612 },
];

export function CertificateClient() {
  const [source, setSource] = useState<Source>("paste");
  const [rows, setRows] = useState<Rows>({ headers: [], rows: [] });
  const [pasteText, setPasteText] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [layout, setLayout] = useState<CertificateLayout | typeof CUSTOM_LAYOUT_ID>("classic");
  const [title, setTitle] = useState("Certificate of completion");
  const [bodyLine, setBodyLine] = useState("This certifies that");
  const [detailLine, setDetailLine] = useState("has completed the workshop");
  const [dateText, setDateText] = useState("");
  const [signatureName, setSignatureName] = useState("SPARK");
  const [recipientField, setRecipientField] = useState("Name");

  const [overrides, setOverrides] = useState<DesignOverrides>({ v: 1 });
  const [uploadedFonts, setUploadedFonts] = useState<{ id: string; label: string }[]>([]);
  const [previewFonts, setPreviewFonts] = useState<FontBytes | undefined>(undefined);

  // hydrate persisted design on mount (SSR-safe: starts as {v:1})
  useEffect(() => {
    const loaded = loadDesign(TOOL_ID);
    if (loaded) setOverrides(loaded);
  }, []);

  // hydrate session-uploaded fonts on mount so fonts uploaded on another tool
  // (same session) appear in this tool's font pickers too
  useEffect(() => { setUploadedFonts(listUploadedFonts()); }, []);

  // persist on every panel change (not via an effect, which would clobber the
  // stored design with the {v:1} default before hydration lands)
  function changeOverrides(next: DesignOverrides) {
    setOverrides(next);
    saveDesign(TOOL_ID, next);
  }

  // Custom (F3) design: initialise empty (SSR-safe), hydrate the design JSON
  // plus every referenced asset from IndexedDB after mount, persist on change.
  const [customDesign, setCustomDesign] = useState<CustomDesign>(EMPTY_CUSTOM);
  const [customAssets, setCustomAssets] = useState<Record<string, string>>({});
  useEffect(() => {
    const saved = loadCustomDesign(TOOL_ID);
    if (!saved) return;
    setCustomDesign(saved);
    // hydrate every referenced asset from IndexedDB into src strings
    const ids = new Set<string>();
    if (saved.background) ids.add(saved.background.assetId);
    for (const el of saved.elements) if (el.type === "image") ids.add(el.assetId);
    void Promise.all(Array.from(ids).map(async (id) => {
      const a = await getAsset(id);
      if (!a) return null;
      const kind = a.mime === "application/pdf" ? "pdf" as const : a.mime === "image/jpeg" ? "jpg" as const : "png" as const;
      return [id, assetSrc(kind, a.bytes)] as const;
    })).then((pairs) => {
      setCustomAssets(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => !!p)));
    });
  }, []);

  function changeCustomDesign(next: CustomDesign) {
    setCustomDesign(next);
    saveCustomDesign(TOOL_ID, next);
  }

  // keep pasted rows live
  useEffect(() => {
    if (source === "paste") setRows(parseDelimited(pasteText));
  }, [source, pasteText]);

  const isCustom = layout === CUSTOM_LAYOUT_ID;
  const layoutSpec = useMemo(() => certificateSpec({
    layout: isCustom ? "classic" : layout, title, bodyLine, recipientField, detailLine, dateText,
    signatureName: signatureName || undefined,
  }), [isCustom, layout, title, bodyLine, recipientField, detailLine, dateText, signatureName]);

  const spec = useMemo(
    () => (isCustom ? customDesignToSpec(customDesign, customAssets) : layoutSpec),
    [isCustom, customDesign, customAssets, layoutSpec],
  );
  // Designer overrides apply to built-in layouts only; a custom design IS the design.
  const finalSpec = useMemo(() => (isCustom ? spec : applyDesign(spec, overrides)), [isCustom, spec, overrides]);
  const slots = useMemo(() => designSlots(layoutSpec), [layoutSpec]);

  const fields = useMemo(() => deriveFields(spec), [spec]);
  const mapping = useMemo(() => autoMatchColumns(fields, rows.headers), [fields, rows.headers]);
  const recipientColumn = mapping[recipientField] ?? recipientField;

  // Resolve every derived field's token against its matched column, and the
  // recipient's fixed token against the user's chosen recipient column.
  const mergedRows = useMemo(
    () => remapRows(rows.rows, fields, mapping, CERTIFICATE_RECIPIENT_DEFAULT, recipientColumn),
    [rows.rows, fields, mapping, recipientColumn],
  );

  const fontKey = useMemo(() => specFontIds(finalSpec).join("|"), [finalSpec]);

  // resolve preview fonts async, keyed on the set of fontIds actually in use
  useEffect(() => {
    let live = true;
    withDesignFonts(finalSpec).then((f) => { if (live) setPreviewFonts(f); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey]);

  function handleUploadFont(name: string, bytes: Uint8Array) {
    addUploadedFont(name, bytes);
    setUploadedFonts(listUploadedFonts());
  }

  async function download(kind: "combined" | "zip") {
    setBusy(true); setError(null);
    try {
      const fonts = await withDesignFonts(finalSpec);
      if (kind === "combined") {
        const bytes = await renderCombined(finalSpec, mergedRows, fonts);
        triggerDownload(new Blob([bytes as BlobPart], { type: "application/pdf" }), "certificates.pdf");
      } else {
        const blob = await renderZip(finalSpec, mergedRows, recipientField, fonts);
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
  const columnOk = rows.headers.length === 0 || rows.headers.includes(recipientColumn);
  const ready = count > 0 && columnOk;

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
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <input className="field flex-1 min-h-[44px] sm:min-h-0" placeholder="Paste a Google Sheet link"
              value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
            <button className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={loadSheet} disabled={busy || !sheetUrl}>Load</button>
          </div>
        )}
        <p className="mt-2 text-sm text-muted">{count} {count === 1 ? "row" : "rows"} loaded</p>
      </div>

      {/* 2. layout + copy */}
      <div className="card space-y-3">
        <p className="text-sm font-medium">Design</p>
        <Segmented
          options={[...CERTIFICATE_LAYOUTS.map((l) => ({ value: l.id, label: l.label })), { value: CUSTOM_LAYOUT_ID, label: "Custom" }]}
          value={layout}
          onChange={(v) => setLayout(v as CertificateLayout | typeof CUSTOM_LAYOUT_ID)}
        />
        <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0">
          {isCustom ? (
          <div className="lg:col-span-2">
            <CustomDesignEditor
              design={customDesign}
              onChange={changeCustomDesign}
              fields={CERTIFICATE_CUSTOM_FIELDS.concat([{ key: CERTIFICATE_RECIPIENT_DEFAULT, label: "Recipient column" }])}
              spec={finalSpec}
              sampleRow={mergedRows[0] ?? EMPTY_ROW}
              previewFonts={previewFonts}
              assets={customAssets}
              onAssetAdded={(id, src) => setCustomAssets((s) => ({ ...s, [id]: src }))}
              onError={setError}
            />
            <label className="block text-sm font-medium mt-3">Recipient column
              <input className="field mt-1 w-full min-h-[44px] sm:min-h-0" value={recipientField} onChange={(e) => setRecipientField(e.target.value)} />
            </label>
          </div>
          ) : (
          <>
          <div className="order-first mb-3 lg:order-last lg:mb-0">
            <MergePreview spec={finalSpec} row={mergedRows[0] ?? EMPTY_ROW} fonts={previewFonts} className="lg:sticky lg:top-4" />
          </div>
          <div className="space-y-3">
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
            <DesignPanel
              key={TOOL_ID}
              toolId={TOOL_ID}
              presets={SIZE_PRESETS}
              slots={slots}
              value={overrides}
              onChange={changeOverrides}
              onUploadFont={handleUploadFont}
              uploadedFonts={uploadedFonts}
            />
          </div>
          </>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* 3. output */}
      <div className="card flex flex-col sm:flex-row sm:flex-wrap gap-3">
        <button className="btn btn-accent inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto"
          onClick={() => download("combined")} disabled={!ready || busy}>
          <Download className="w-4 h-4" strokeWidth={1.75} /> Combined PDF
        </button>
        <button className="btn inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto"
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
      <input className="field mt-1 w-full min-h-[44px] sm:min-h-0" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
