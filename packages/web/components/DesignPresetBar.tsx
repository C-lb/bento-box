"use client";
import { useEffect, useState } from "react";
import type { DocumentSpec } from "@event-editor/core/merge";
import type { DesignOverrides } from "@event-editor/core/design";
import type { CustomDesign } from "@event-editor/core/custom-design";
import {
  captureUploadFontIds,
  createPreset,
  deletePreset,
  listPresets,
  renamePreset,
  updatePreset,
  type DesignPreset,
  type DesignPresetCapture,
} from "@/lib/design-presets";
import { renderDesignPresetThumb } from "@/lib/design-preset-thumb";
import { getUploadedFont } from "@/lib/designer-fonts";
import { getAsset } from "@/lib/design-assets";
import type { FontBytes } from "@/lib/merge-render";

interface Props {
  toolId: string;
  /** Whether the tool is currently in custom-canvas mode. */
  isCustom: boolean;
  /** Current built-in layout id (ignored when isCustom). */
  layoutId: string;
  overrides: DesignOverrides;
  customDesign: CustomDesign;
  /** The final spec of the current look (background injected), for thumbnails. */
  spec: DocumentSpec;
  /** Sample row for the thumbnail render (EMPTY_ROW is fine). */
  row: Record<string, string>;
  fonts?: FontBytes;
  /** Applies a preset into the client's layout/overrides/custom-design state. */
  onApply: (preset: DesignPreset) => void | Promise<void>;
}

/**
 * Save/apply bar for merge-tool design presets, mirroring the headshot
 * studio's PresetBar: save the current look, then apply, update, rename, or
 * delete saved looks. Mounted in MergeToolClient and CertificateClient.
 */
export function DesignPresetBar({ toolId, isCustom, layoutId, overrides, customDesign, spec, row, fonts, onApply }: Props) {
  const [presets, setPresets] = useState<DesignPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => setPresets(listPresets(toolId));
  useEffect(() => { setPresets(listPresets(toolId)); }, [toolId]);

  function currentCapture(): DesignPresetCapture {
    return isCustom
      ? { kind: "custom", customDesign }
      : { kind: "design", layoutId, overrides };
  }

  // Session uploads are never persisted, so a look built on one only keeps
  // the font id in the preset. Surface that quietly at save time.
  const savingWithUploadedFonts = saving && captureUploadFontIds(currentCapture()).length > 0;

  async function doSave() {
    setBusy(true);
    try {
      const preview = await renderDesignPresetThumb(spec, row, fonts);
      createPreset(toolId, { name, preview, capture: currentCapture() });
      setSaving(false);
      setName("");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function doUpdate(p: DesignPreset) {
    setBusy(true);
    try {
      const preview = await renderDesignPresetThumb(spec, row, fonts);
      updatePreset(toolId, p.id, { preview, capture: currentCapture() });
      setActiveId(p.id);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  function doRename(id: string) {
    renamePreset(toolId, id, renameText);
    setRenaming(null);
    refresh();
  }

  function doDelete(id: string) {
    deletePreset(toolId, id);
    if (activeId === id) setActiveId(null);
    refresh();
  }

  async function doApply(p: DesignPreset) {
    setBusy(true);
    try {
      const notes: string[] = [];
      const missingFonts = captureUploadFontIds(p).filter((id) => !getUploadedFont(id));
      if (missingFonts.length > 0) {
        notes.push("Uploaded fonts are not saved with presets, so a bundled font is used instead.");
      }
      if (p.kind === "custom" && p.customDesign.background) {
        const bg = await getAsset(p.customDesign.background.assetId).catch(() => undefined);
        if (!bg) notes.push("This preset's background image is no longer on this device, so it was skipped.");
      }
      if (p.kind === "design" && p.overrides.background && "assetId" in p.overrides.background) {
        const bg = await getAsset(p.overrides.background.assetId).catch(() => undefined);
        if (!bg) notes.push("This preset's background image is no longer on this device, so it was skipped.");
      }
      await onApply(p);
      setActiveId(p.id);
      setNote(notes.length ? notes.join(" ") : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Presets</span>
        {!saving && (
          <button type="button" className="btn min-h-[44px] sm:min-h-0 text-sm" onClick={() => { setName(""); setSaving(true); }}>
            Save current look
          </button>
        )}
      </div>

      {saving && (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
          <input
            className="field min-h-[44px] sm:min-h-0"
            placeholder="Preset name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !busy) doSave(); }}
          />
          {savingWithUploadedFonts && (
            <p className="text-sm text-muted">Uploaded fonts are not saved with presets.</p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-accent min-h-[44px] sm:min-h-0 text-sm"
              onClick={doSave} disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Save preset"}
            </button>
            <button type="button" className="btn min-h-[44px] sm:min-h-0 text-sm" onClick={() => setSaving(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {note && <p className="text-sm text-muted">{note}</p>}

      {presets.length === 0 ? (
        <p className="text-sm text-muted">No presets yet. Style a design, then save the look to reuse it.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {presets.map((p) => (
            <div key={p.id} className={`overflow-hidden rounded-xl border ${activeId === p.id ? "border-accent" : "border-line"}`}>
              <button type="button" className="block w-full" onClick={() => doApply(p)} disabled={busy} data-tip="Apply this look">
                {p.preview ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.preview} alt={p.name} className="aspect-[4/3] w-full bg-raised object-contain" />
                ) : (
                  <span className="flex aspect-[4/3] w-full items-center justify-center bg-raised text-sm text-muted">No preview</span>
                )}
              </button>
              <div className="flex flex-col gap-2 p-2.5">
                {renaming === p.id ? (
                  <input
                    className="field min-h-[40px] text-sm" value={renameText} autoFocus
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") doRename(p.id); if (e.key === "Escape") setRenaming(null); }}
                    onBlur={() => doRename(p.id)}
                  />
                ) : (
                  <p className="truncate text-sm text-ink" title={p.name}>{p.name}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="btn min-h-[36px] px-2 py-1 text-xs" onClick={() => doApply(p)} disabled={busy}>Apply</button>
                  <button type="button" className="btn min-h-[36px] px-2 py-1 text-xs" onClick={() => doUpdate(p)} disabled={busy} data-tip="Overwrite with the current look">Update</button>
                  <button type="button" className="btn min-h-[36px] px-2 py-1 text-xs" onClick={() => { setRenaming(p.id); setRenameText(p.name); }}>Rename</button>
                  <button type="button" className="btn min-h-[36px] px-2 py-1 text-xs text-danger" onClick={() => doDelete(p.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
