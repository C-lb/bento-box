"use client";
import { useEffect, useState } from "react";
import type { HeadshotStyle } from "@event-editor/core/frames";
import {
  createPreset,
  deletePreset,
  listPresets,
  renamePreset,
  updatePreset,
  type HeadshotPreset,
} from "@/lib/headshot-presets";
import { renderPresetThumb } from "@/lib/headshot-preset-thumb";

interface Props {
  frameId: string;
  style: HeadshotStyle;
  /** Full management (save/update/rename/delete). false = apply-only (batch). */
  manage: boolean;
  activeId?: string | null;
  onApply: (preset: HeadshotPreset) => void;
}

export function PresetBar({ frameId, style, manage, activeId, onApply }: Props) {
  const [presets, setPresets] = useState<HeadshotPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [includeCompany, setIncludeCompany] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const refresh = () => setPresets(listPresets());
  useEffect(() => { refresh(); }, []);

  const hasCompany = !!style.companyText?.trim();

  function openSave() {
    setName("");
    setIncludeCompany(hasCompany);
    setSaving(true);
  }

  async function doSave() {
    setBusy(true);
    try {
      const preview = await renderPresetThumb(frameId, style);
      createPreset({ name, frameId, style, includeCompany, preview });
      setSaving(false);
      setName("");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function doUpdate(p: HeadshotPreset) {
    setBusy(true);
    try {
      const preview = await renderPresetThumb(frameId, style);
      updatePreset(p.id, { frameId, style, includeCompany: hasCompany, preview });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  function doRename(id: string) {
    renamePreset(id, renameText);
    setRenaming(null);
    refresh();
  }

  function doDelete(id: string) {
    deletePreset(id);
    refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Presets</span>
        {manage && !saving && (
          <button type="button" className="btn min-h-[44px] sm:min-h-0 text-sm" onClick={openSave}>
            Save current look
          </button>
        )}
      </div>

      {manage && saving && (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
          <input
            className="field min-h-[44px] sm:min-h-0"
            placeholder="Preset name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim() && !busy) doSave(); }}
          />
          {hasCompany && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" className="h-[18px] w-[18px]" checked={includeCompany}
                onChange={(e) => setIncludeCompany(e.target.checked)} />
              Include the company text ({style.companyText})
            </label>
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

      {presets.length === 0 ? (
        <p className="text-sm text-muted">
          {manage ? "No presets yet. Style a card, then save the look to reuse it." : "No saved presets yet. Create them in the Headshot studio."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {presets.map((p) => (
            <div key={p.id} className={`overflow-hidden rounded-xl border ${activeId === p.id ? "border-accent" : "border-line"}`}>
              <button type="button" className="block w-full" onClick={() => onApply(p)} data-tip="Apply this look">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={p.name} className="aspect-square w-full bg-raised object-cover" />
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
                {manage && (
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="btn min-h-[36px] px-2 py-1 text-xs" onClick={() => onApply(p)}>Apply</button>
                    <button type="button" className="btn min-h-[36px] px-2 py-1 text-xs" onClick={() => doUpdate(p)} disabled={busy} data-tip="Overwrite with the current look">Update</button>
                    <button type="button" className="btn min-h-[36px] px-2 py-1 text-xs" onClick={() => { setRenaming(p.id); setRenameText(p.name); }}>Rename</button>
                    <button type="button" className="btn min-h-[36px] px-2 py-1 text-xs text-danger" onClick={() => doDelete(p.id)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
