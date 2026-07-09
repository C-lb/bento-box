"use client";
import { useRef, useState } from "react";
import { Segmented } from "@/components/Segmented";
import { MM_TO_PT, type DesignOverrides, type TextStyle } from "@event-editor/core/design";
import { DESIGNER_FONTS } from "@/lib/designer-fonts";

export type SizePreset = { id: string; label: string; width: number; height: number };

const DIMS_EPSILON = 0.5; // pt tolerance when matching a preset

function mmFromPt(pt: number): number {
  return Math.round((pt / MM_TO_PT) * 10) / 10;
}

function ptFromMm(mm: number): number {
  return mm * MM_TO_PT;
}

function matchPreset(presets: SizePreset[], size?: { width: number; height: number }): SizePreset | undefined {
  if (!size) return undefined;
  return presets.find(
    (p) => Math.abs(p.width - size.width) < DIMS_EPSILON && Math.abs(p.height - size.height) < DIMS_EPSILON,
  );
}

export function DesignPanel({
  toolId,
  presets,
  slots,
  value,
  onChange,
  onUploadFont,
  uploadedFonts,
}: {
  toolId: string;
  presets: SizePreset[];
  slots: { id: string; label: string }[];
  value: DesignOverrides;
  onChange: (o: DesignOverrides) => void;
  onUploadFont: (name: string, bytes: Uint8Array) => void;
  uploadedFonts: { id: string; label: string }[];
}) {
  const fontInputRef = useRef<HTMLInputElement>(null);
  // Tracks an explicit "Custom" click so the mm inputs stay revealed even
  // before the user has typed a value that diverges from the current preset
  // match (otherwise the derived selection would snap straight back to that
  // preset and the fields would never appear).
  const [customChosen, setCustomChosen] = useState(false);

  const matched = matchPreset(presets, value.pageSize);
  const derivedSize = value.pageSize ? (matched?.id ?? "custom") : (presets[0]?.id ?? "custom");
  const selectedSize = customChosen ? "custom" : derivedSize;
  const effectiveWidthPt = value.pageSize?.width ?? matched?.width ?? presets[0]?.width ?? 0;
  const effectiveHeightPt = value.pageSize?.height ?? matched?.height ?? presets[0]?.height ?? 0;

  function setPageSize(width: number, height: number) {
    onChange({ ...value, pageSize: { width, height } });
  }

  function updateSlot(slotId: string, fn: (style: TextStyle) => TextStyle) {
    const current = value.text?.[slotId] ?? {};
    const next = fn(current);
    onChange({ ...value, text: { ...(value.text ?? {}), [slotId]: next } });
  }

  function setBorder(patch: Partial<{ style: "none" | "single" | "double"; color: string; width: number; inset: number }>) {
    const current = value.border ?? { style: "none" as const, color: "#1a1a1a", width: 1, inset: 24 };
    onChange({ ...value, border: { ...current, ...patch } });
  }

  function updateDivider(index: number, patch: Partial<{ y: number; widthFrac: number; color: string; thickness: number }>) {
    const dividers = (value.dividers ?? []).map((d, i) => (i === index ? { ...d, ...patch } : d));
    onChange({ ...value, dividers });
  }

  function addDivider() {
    const dividers = [...(value.dividers ?? []), { y: 0.3, widthFrac: 0.6, thickness: 1, color: "#1a1a1a" }];
    onChange({ ...value, dividers });
  }

  function removeDivider(index: number) {
    const dividers = (value.dividers ?? []).filter((_, i) => i !== index);
    onChange({ ...value, dividers });
  }

  async function handleFontUpload(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    onUploadFont(file.name, bytes);
  }

  const border = value.border ?? { style: "none" as const, color: "#1a1a1a", width: 1, inset: 24 };

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-ink hover:text-accent">Customise</summary>
      <div className="mt-4 space-y-5">
        {/* Size */}
        <section className="space-y-2">
          <p className="text-sm font-medium">Size</p>
          <div className="overflow-x-auto pb-1">
            <Segmented
              options={[...presets.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom" }]}
              value={selectedSize}
              onChange={(v) => {
                if (v === "custom") {
                  setCustomChosen(true);
                  return;
                }
                setCustomChosen(false);
                const preset = presets.find((p) => p.id === v);
                if (preset) setPageSize(preset.width, preset.height);
              }}
            />
          </div>
          {selectedSize === "custom" && (
            <div className="flex flex-col sm:flex-row gap-2">
              <label className="block text-sm font-medium flex-1">Width (mm)
                <input
                  type="number"
                  className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                  value={mmFromPt(effectiveWidthPt)}
                  onChange={(e) => {
                    const mm = Number(e.target.value);
                    if (Number.isNaN(mm)) return;
                    setPageSize(ptFromMm(mm), effectiveHeightPt);
                  }}
                />
              </label>
              <label className="block text-sm font-medium flex-1">Height (mm)
                <input
                  type="number"
                  className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                  value={mmFromPt(effectiveHeightPt)}
                  onChange={(e) => {
                    const mm = Number(e.target.value);
                    if (Number.isNaN(mm)) return;
                    setPageSize(effectiveWidthPt, ptFromMm(mm));
                  }}
                />
              </label>
            </div>
          )}
        </section>

        {/* Text styles */}
        {slots.length > 0 && (
          <section className="space-y-3">
            <p className="text-sm font-medium">Text</p>
            {slots.map((slot) => {
              const style = value.text?.[slot.id] ?? {};
              const hasStroke = !!style.stroke;
              return (
                <div key={slot.id} className="space-y-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
                  <p className="text-sm text-muted">{slot.label}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <label className="block text-sm">Font
                      <select
                        className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                        value={style.fontId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateSlot(slot.id, (s) => {
                            const next = { ...s };
                            if (v) next.fontId = v;
                            else delete next.fontId;
                            return next;
                          });
                        }}
                      >
                        <option value="">Layout default</option>
                        <optgroup label="Fonts">
                          {DESIGNER_FONTS.map((f) => (
                            <option key={f.id} value={f.id}>{f.label}</option>
                          ))}
                        </optgroup>
                        {uploadedFonts.length > 0 && (
                          <optgroup label="Uploaded">
                            {uploadedFonts.map((f) => (
                              <option key={f.id} value={f.id}>{f.label}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </label>
                    <label className="block text-sm">Size (pt)
                      <input
                        type="number"
                        className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                        placeholder="Default"
                        value={style.size ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateSlot(slot.id, (s) => {
                            const next = { ...s };
                            if (raw === "") { delete next.size; return next; }
                            const n = Number(raw);
                            if (!Number.isNaN(n)) next.size = n;
                            return next;
                          });
                        }}
                      />
                    </label>
                    <label className="block text-sm">Tracking
                      <input
                        type="number"
                        step={0.1}
                        className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                        placeholder="Default"
                        value={style.letterSpacing ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateSlot(slot.id, (s) => {
                            const next = { ...s };
                            if (raw === "") { delete next.letterSpacing; return next; }
                            const n = Number(raw);
                            if (!Number.isNaN(n)) next.letterSpacing = n;
                            return next;
                          });
                        }}
                      />
                    </label>
                    <label className="block text-sm">Colour
                      <input
                        type="color"
                        className="field mt-1 w-full min-h-[44px] sm:min-h-0 p-1"
                        value={style.color ?? "#1a1a1a"}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateSlot(slot.id, (s) => ({ ...s, color: v }));
                        }}
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm min-h-[44px] sm:min-h-0">
                    <input
                      type="checkbox"
                      checked={hasStroke}
                      onChange={(e) => {
                        const on = e.target.checked;
                        updateSlot(slot.id, (s) => ({
                          ...s,
                          stroke: on ? { color: "#1a1a1a", width: 0.75 } : null,
                        }));
                      }}
                    />
                    Outline
                  </label>
                  {hasStroke && style.stroke && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-sm">Outline colour
                        <input
                          type="color"
                          className="field mt-1 w-full min-h-[44px] sm:min-h-0 p-1"
                          value={style.stroke.color}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateSlot(slot.id, (s) => (s.stroke ? { ...s, stroke: { ...s.stroke, color: v } } : s));
                          }}
                        />
                      </label>
                      <label className="block text-sm">Outline width
                        <input
                          type="number"
                          step={0.25}
                          className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                          value={style.stroke.width}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isNaN(n)) return;
                            updateSlot(slot.id, (s) => (s.stroke ? { ...s, stroke: { ...s.stroke, width: n } } : s));
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* Border */}
        <section className="space-y-2">
          <p className="text-sm font-medium">Border</p>
          <Segmented
            options={[
              { value: "none", label: "None" },
              { value: "single", label: "Single" },
              { value: "double", label: "Double" },
            ]}
            value={border.style}
            onChange={(v) => setBorder({ style: v as "none" | "single" | "double" })}
          />
          {border.style !== "none" && (
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-sm">Colour
                <input
                  type="color"
                  className="field mt-1 w-full min-h-[44px] sm:min-h-0 p-1"
                  value={border.color}
                  onChange={(e) => setBorder({ color: e.target.value })}
                />
              </label>
              <label className="block text-sm">Thickness
                <input
                  type="number"
                  step={0.5}
                  className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                  value={border.width}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isNaN(n)) setBorder({ width: n });
                  }}
                />
              </label>
              <label className="block text-sm">Inset (pt)
                <input
                  type="number"
                  className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                  value={border.inset}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isNaN(n)) setBorder({ inset: n });
                  }}
                />
              </label>
            </div>
          )}
        </section>

        {/* Dividers */}
        <section className="space-y-2">
          <p className="text-sm font-medium">Dividers</p>
          {(value.dividers ?? []).map((d, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
              <label className="block text-sm">Position (%)
                <input
                  type="number"
                  className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                  value={Math.round(d.y * 100)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isNaN(n)) updateDivider(i, { y: n / 100 });
                  }}
                />
              </label>
              <label className="block text-sm">Width (%)
                <input
                  type="number"
                  className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                  value={Math.round(d.widthFrac * 100)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isNaN(n)) updateDivider(i, { widthFrac: n / 100 });
                  }}
                />
              </label>
              <label className="block text-sm">Thickness
                <input
                  type="number"
                  step={0.5}
                  className="field mt-1 w-full min-h-[44px] sm:min-h-0"
                  value={d.thickness}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isNaN(n)) updateDivider(i, { thickness: n });
                  }}
                />
              </label>
              <label className="block text-sm">Colour
                <input
                  type="color"
                  className="field mt-1 w-full min-h-[44px] sm:min-h-0 p-1"
                  value={d.color}
                  onChange={(e) => updateDivider(i, { color: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn min-h-[44px] sm:min-h-0 justify-center"
                onClick={() => removeDivider(i)}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn min-h-[44px] sm:min-h-0" onClick={addDivider}>
            Add divider
          </button>
        </section>

        {/* Font upload */}
        <section className="space-y-2">
          <p className="text-sm font-medium">Upload a font</p>
          <input
            ref={fontInputRef}
            type="file"
            accept=".ttf,.otf"
            className="field min-h-[44px] sm:min-h-0"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFontUpload(file);
              e.target.value = "";
            }}
          />
          <p className="text-sm text-muted">Uploaded fonts last for this session only.</p>
        </section>

        <button
          type="button"
          className="btn min-h-[44px] sm:min-h-0"
          onClick={() => onChange({ v: 1 })}
        >
          Reset design
        </button>
      </div>
      <p className="sr-only">Design settings for {toolId}</p>
    </details>
  );
}
