"use client";
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { AttendeeListInput } from "@/components/AttendeeListInput";
import { DesignPanel, type SizePreset } from "@/components/DesignPanel";
import { MergePreview } from "@/components/MergePreview";
import { loadDesign, saveDesign } from "@/components/design-store";
import { CustomDesignEditor } from "@/components/CustomDesignEditor";
import { loadCustomDesign, saveCustomDesign } from "@/components/custom-design-store";
import { hydrateAssetSrcs, gcAssetIfUnreferenced } from "@/lib/design-assets";
import { DesignPresetBar } from "@/components/DesignPresetBar";
import type { DesignPreset } from "@/lib/design-presets";
import { autoMatchColumns, deriveFields, remapRows, type Rows, type DocumentSpec } from "@event-editor/core/merge";
import { applyDesign, withBackground, type DesignOverrides } from "@event-editor/core/design";
import { loadBackgroundById } from "@/lib/design-backgrounds";
import { customDesignToSpec, type CustomDesign } from "@event-editor/core/custom-design";
import { renderCombined, renderZip, renderSheet, type FontBytes } from "@/lib/merge-render";
import { triggerDownload } from "@/lib/merge-download";
import { designSlots, specFontIds, withDesignFonts, EMPTY_ROW } from "@/lib/design-tools";
import { addUploadedFont, listUploadedFonts } from "@/lib/designer-fonts";
import { PastMergeOutputs, usePastMergeOutputs } from "@/components/PastMergeOutputs";

export const CUSTOM_LAYOUT_ID = "__custom";

const EMPTY_CUSTOM: CustomDesign = {
  v: 1,
  page: { width: 841.89, height: 595.28 }, // A4 landscape default until a background sets the size
  background: null,
  elements: [],
};

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
  /** Plural noun for the history panel, e.g. "badges", "place cards". */
  historyNoun: string;
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

  // Custom (F3) design: initialise empty (SSR-safe), hydrate the design JSON
  // plus every referenced asset from IndexedDB after mount, persist on change.
  const [customDesign, setCustomDesign] = useState<CustomDesign>(EMPTY_CUSTOM);
  const [customAssets, setCustomAssets] = useState<Record<string, string>>({});
  useEffect(() => {
    const saved = loadCustomDesign(config.toolId);
    if (!saved) return;
    setCustomDesign(saved);
    // hydrate every referenced asset from IndexedDB into src strings
    void hydrateAssetSrcs(saved).then(setCustomAssets);
  }, [config.toolId]);

  function changeCustomDesign(next: CustomDesign) {
    setCustomDesign(next);
    saveCustomDesign(config.toolId, next);
  }

  // Preset apply: one shot into the same setters + stores the panel/editor
  // use, so the applied look persists exactly like a manual edit would.
  async function applyPreset(p: DesignPreset) {
    if (p.kind === "custom") {
      changeCustomDesign(p.customDesign);
      setCustomAssets(await hydrateAssetSrcs(p.customDesign));
      setLayout(CUSTOM_LAYOUT_ID);
    } else {
      changeOverrides(p.overrides);
      setLayout(config.layouts.some((l) => l.id === p.layoutId) ? p.layoutId : config.layouts[0].id);
    }
  }

  const [uploadedFonts, setUploadedFonts] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => { setUploadedFonts(listUploadedFonts()); }, []);
  function handleUploadFont(name: string, bytes: Uint8Array) {
    addUploadedFont(name, bytes);
    setUploadedFonts(listUploadedFonts());
  }

  const isCustom = layout === CUSTOM_LAYOUT_ID;
  const spec = useMemo(
    () => isCustom
      ? customDesignToSpec(customDesign, customAssets)
      : config.buildSpec({ layout, text, toggles, recipientField }),
    [config, isCustom, customDesign, customAssets, layout, text, toggles, recipientField],
  );
  // Bundled background: resolve the selected id to bytes async (memo-cached
  // fetch), then inject via withBackground so the preview picks it up on the
  // next finalSpec change, mirroring the async preview-font loading below.
  const backgroundId = !isCustom ? overrides.background?.id : undefined;
  const [loadedBackground, setLoadedBackground] = useState<DocumentSpec["background"] | undefined>(undefined);
  useEffect(() => {
    if (!backgroundId) { setLoadedBackground(undefined); return; }
    let live = true;
    loadBackgroundById(backgroundId)
      .then((b) => { if (live) setLoadedBackground(b); })
      .catch(() => { if (live) setLoadedBackground(undefined); });
    return () => { live = false; };
  }, [backgroundId]);

  // Designer overrides apply to built-in layouts only; a custom design IS the design.
  const finalSpec = useMemo(
    () => (isCustom ? spec : withBackground(applyDesign(spec, overrides), backgroundId ? loadedBackground : undefined)),
    [isCustom, spec, overrides, backgroundId, loadedBackground],
  );
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

  // Resolve every derived field's token against its matched column, and the
  // recipient's fixed token against the user's chosen recipient column.
  const mergedRows = useMemo(
    () => remapRows(rows.rows, fields, mapping, config.recipientDefault, recipientColumn),
    [rows.rows, fields, mapping, config.recipientDefault, recipientColumn],
  );

  const columnOk = rows.headers.length === 0 || rows.headers.includes(recipientColumn);
  const ready = mergedRows.length > 0 && columnOk;

  // "See past …" history: recorded best-effort at the moment a download fires.
  const past = usePastMergeOutputs(config.toolId);

  async function download(kind: "combined" | "zip" | "sheet") {
    setBusy(true); setError(null);
    try {
      // Re-resolve the background at render time (cached after the preview
      // fetch) so the final PDF never races the async preview load.
      const renderSpec = backgroundId
        ? withBackground(finalSpec, await loadBackgroundById(backgroundId))
        : finalSpec;
      const fonts = await withDesignFonts(renderSpec);
      if (kind === "combined") {
        const blob = new Blob([(await renderCombined(renderSpec, mergedRows, fonts)) as BlobPart], { type: "application/pdf" });
        triggerDownload(blob, `${config.fileBase}.pdf`);
        past.record(`${config.fileBase}.pdf`, blob);
      } else if (kind === "sheet") {
        const blob = new Blob([(await renderSheet(renderSpec, mergedRows, fonts)) as BlobPart], { type: "application/pdf" });
        triggerDownload(blob, `${config.fileBase}-sheet.pdf`);
        past.record(`${config.fileBase}-sheet.pdf`, blob);
      } else {
        const blob = await renderZip(renderSpec, mergedRows, recipientField, fonts);
        triggerDownload(blob, `${config.fileBase}.zip`);
        past.record(`${config.fileBase}.zip`, blob);
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
        <Segmented
          options={[...config.layouts.map((l) => ({ value: l.id, label: l.label })), { value: CUSTOM_LAYOUT_ID, label: "Custom" }]}
          value={layout}
          onChange={setLayout}
        />
        <DesignPresetBar
          toolId={config.toolId}
          isCustom={isCustom}
          layoutId={layout}
          overrides={overrides}
          customDesign={customDesign}
          spec={finalSpec}
          row={mergedRows[0] ?? EMPTY_ROW}
          fonts={previewFonts}
          onApply={applyPreset}
        />
        {isCustom ? (
          <div>
            <CustomDesignEditor
              design={customDesign}
              onChange={changeCustomDesign}
              fields={config.copyFields.map((f) => ({ key: f.key, label: f.label })).concat([{ key: config.recipientDefault, label: config.recipientLabel }])}
              spec={finalSpec}
              sampleRow={mergedRows[0] ?? EMPTY_ROW}
              previewFonts={previewFonts}
              assets={customAssets}
              onAssetAdded={(id, src) => setCustomAssets((s) => ({ ...s, [id]: src }))}
              onAssetRemoved={(id) => void gcAssetIfUnreferenced(id).catch(() => {})}
              onError={setError}
            />
            <label className="block text-sm font-medium mt-3">{config.recipientLabel}
              <input className="field mt-1 w-full min-h-[44px] sm:min-h-0" value={recipientField} onChange={(e) => setRecipientField(e.target.value)} />
            </label>
          </div>
        ) : (
          <>
          {/* Full-width preview row: the aspect-ratio container fills the card
              width, so the wider page = a visibly larger preview. */}
          <MergePreview spec={finalSpec} row={mergedRows[0] ?? EMPTY_ROW} fonts={previewFonts} />
          <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0 lg:items-start">
            <div className="space-y-3">
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
            </div>
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
          </>
        )}
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

      <PastMergeOutputs noun={config.historyNoun} items={past.items} onRemove={past.remove} onClear={past.clear} />
    </div>
  );
}
