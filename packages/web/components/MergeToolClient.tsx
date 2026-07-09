"use client";
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { AttendeeListInput } from "@/components/AttendeeListInput";
import { DesignPanel, type SizePreset } from "@/components/DesignPanel";
import { MergePreview } from "@/components/MergePreview";
import { loadDesign, saveDesign } from "@/components/design-store";
import { autoMatchColumns, deriveFields, type Rows, type DocumentSpec } from "@event-editor/core/merge";
import { applyDesign, type DesignOverrides } from "@event-editor/core/design";
import { renderCombined, renderZip, renderSheet, type FontBytes } from "@/lib/merge-render";
import { triggerDownload } from "@/lib/merge-download";
import { designSlots, specFontIds, withDesignFonts, EMPTY_ROW } from "@/lib/design-tools";
import { addUploadedFont, listUploadedFonts } from "@/lib/designer-fonts";

export interface MergeField { key: string; label: string; default: string }
export interface MergeToolConfig {
  toolId: string;
  layouts: readonly { id: string; label: string }[];
  copyFields: MergeField[];
  toggles?: { key: string; label: string; default: boolean }[];
  recipientLabel: string;
  recipientDefault: string;
  sheet: boolean;
  fileBase: string;
  sizePresets: SizePreset[];
  buildSpec: (v: { layout: string; text: Record<string, string>; toggles: Record<string, boolean>; recipientField: string }) => DocumentSpec;
}

export function MergeToolClient(config: MergeToolConfig) {
  const [rows, setRows] = useState<Rows>({ headers: [], rows: [] });
  const [layout, setLayout] = useState<string>(config.layouts[0].id);
  const [text, setText] = useState<Record<string, string>>(
    Object.fromEntries(config.copyFields.map((f) => [f.key, f.default])),
  );
  const [toggles, setToggles] = useState<Record<string, boolean>>(
    Object.fromEntries((config.toggles ?? []).map((t) => [t.key, t.default])),
  );
  const [recipientField, setRecipientField] = useState(config.recipientDefault);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Design overrides: initialise empty (SSR-safe), hydrate from localStorage
  // after mount, persist on every change.
  const [overrides, setOverrides] = useState<DesignOverrides>({ v: 1 });
  useEffect(() => {
    const saved = loadDesign(config.toolId);
    if (saved) setOverrides(saved);
  }, [config.toolId]);
  function changeOverrides(next: DesignOverrides) {
    setOverrides(next);
    saveDesign(config.toolId, next);
  }

  const [uploadedFonts, setUploadedFonts] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => { setUploadedFonts(listUploadedFonts()); }, []);
  function handleUploadFont(name: string, bytes: Uint8Array) {
    addUploadedFont(name, bytes);
    setUploadedFonts(listUploadedFonts());
  }

  const spec = useMemo(
    () => config.buildSpec({ layout, text, toggles, recipientField }),
    [config, layout, text, toggles, recipientField],
  );
  const finalSpec = useMemo(() => applyDesign(spec, overrides), [spec, overrides]);
  const slots = useMemo(() => designSlots(spec), [spec]);

  // Preview fonts: load the bytes for the fontIds the final spec references
  // (plus the bundled heading/body pair) without blocking the UI.
  const [previewFonts, setPreviewFonts] = useState<FontBytes | undefined>(undefined);
  const fontKey = specFontIds(finalSpec).join("|");
  useEffect(() => {
    let live = true;
    withDesignFonts(finalSpec).then((f) => { if (live) setPreviewFonts(f); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey]);
  const fields = useMemo(() => deriveFields(spec), [spec]);
  const mapping = useMemo(() => autoMatchColumns(fields, rows.headers), [fields, rows.headers]);
  const recipientColumn = mapping[recipientField] ?? recipientField;

  const mergedRows = useMemo(
    () => rows.rows.map((r) => {
      const out = { ...r };
      // resolve every derived field's token against its matched column
      for (const fld of fields) {
        const col = mapping[fld] ?? fld;
        out[fld] = r[col] ?? r[fld] ?? "";
      }
      return out;
    }),
    [rows.rows, fields, mapping],
  );

  const columnOk = rows.headers.length === 0 || rows.headers.includes(recipientColumn);
  const ready = mergedRows.length > 0 && columnOk;

  async function download(kind: "combined" | "zip" | "sheet") {
    setBusy(true); setError(null);
    try {
      const fonts = await withDesignFonts(finalSpec);
      if (kind === "combined") {
        const bytes = await renderCombined(finalSpec, mergedRows, fonts);
        triggerDownload(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${config.fileBase}.pdf`);
      } else if (kind === "sheet") {
        const bytes = await renderSheet(finalSpec, mergedRows, fonts);
        triggerDownload(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${config.fileBase}-sheet.pdf`);
      } else {
        const blob = await renderZip(finalSpec, mergedRows, recipientField, fonts);
        triggerDownload(blob, `${config.fileBase}.zip`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-8 space-y-5">
      <AttendeeListInput onRows={setRows} />

      <div className="card space-y-3">
        <p className="text-sm font-medium">Design</p>
        <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0">
          <div className="lg:order-2">
            <MergePreview spec={finalSpec} row={mergedRows[0] ?? EMPTY_ROW} fonts={previewFonts} className="lg:sticky lg:top-4" />
          </div>
          <div className="space-y-3 lg:order-1">
            <Segmented options={config.layouts.map((l) => ({ value: l.id, label: l.label }))} value={layout} onChange={setLayout} />
            {config.copyFields.map((f) => (
              <label key={f.key} className="block text-sm font-medium">{f.label}
                <input className="field mt-1 w-full min-h-[44px] sm:min-h-0" value={text[f.key] ?? ""} onChange={(e) => setText((s) => ({ ...s, [f.key]: e.target.value }))} />
              </label>
            ))}
            <label className="block text-sm font-medium">{config.recipientLabel}
              <input className="field mt-1 w-full min-h-[44px] sm:min-h-0" value={recipientField} onChange={(e) => setRecipientField(e.target.value)} />
            </label>
            {(config.toggles ?? []).map((t) => (
              <label key={t.key} className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={!!toggles[t.key]} onChange={(e) => setToggles((s) => ({ ...s, [t.key]: e.target.checked }))} />
                {t.label}
              </label>
            ))}
            <DesignPanel
              key={config.toolId}
              toolId={config.toolId}
              presets={config.sizePresets}
              slots={slots}
              value={overrides}
              onChange={changeOverrides}
              onUploadFont={handleUploadFont}
              uploadedFonts={uploadedFonts}
            />
          </div>
        </div>
        {rows.headers.length > 0 && !columnOk && (
          <p className="text-sm text-amber-600">No "{recipientColumn}" column found. Available: {rows.headers.join(", ")}.</p>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="card flex flex-col sm:flex-row sm:flex-wrap gap-3">
        <button className="btn btn-accent inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto" onClick={() => download("combined")} disabled={!ready || busy}>
          <Download className="w-4 h-4" strokeWidth={1.75} /> Combined PDF
        </button>
        <button className="btn inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto" onClick={() => download("zip")} disabled={!ready || busy}>
          <Download className="w-4 h-4" strokeWidth={1.75} /> Zip of files
        </button>
        {config.sheet && (
          <button className="btn inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto" onClick={() => download("sheet")} disabled={!ready || busy}>
            <Download className="w-4 h-4" strokeWidth={1.75} /> Cut sheet
          </button>
        )}
      </div>
    </div>
  );
}
