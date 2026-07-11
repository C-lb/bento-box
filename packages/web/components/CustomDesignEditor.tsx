"use client";
import { useRef, useState } from "react";
import { Type, Image as ImageIcon, Upload, Trash2 } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { MergePreview } from "@/components/MergePreview";
import {
  newElementId,
  type CustomDesign,
  type CustomElement,
} from "@event-editor/core/custom-design";
import type { DocumentSpec } from "@event-editor/core/merge";
import type { FontBytes } from "@/lib/merge-render";
import { readBackgroundUpload, readLogoUpload, assetSrc } from "@/lib/custom-upload";
import { putAsset } from "@/lib/design-assets";
import { applyDrag, type DragState } from "@/components/custom-editor-geometry";
// Font options: the designer registry's curated bundle is exported as
// `DESIGNER_FONTS` (see lib/designer-fonts.ts), not `BUNDLED_FONTS`.
import { DESIGNER_FONTS, listUploadedFonts } from "@/lib/designer-fonts";

export interface CustomDesignEditorProps {
  design: CustomDesign;
  onChange: (d: CustomDesign) => void;
  fields: { key: string; label: string }[];
  spec: DocumentSpec;
  sampleRow: Record<string, string>;
  previewFonts: FontBytes | undefined;
  assets: Record<string, string>;
  onAssetAdded: (id: string, src: string) => void;
  onError: (msg: string) => void;
}

const DEFAULT_TEXT = { size: 24, color: "#111111", align: "left" as const };

/** Human label for the overlay box's aria-label, per element kind. */
function elementLabel(el: CustomElement): string {
  if (el.type === "field") return `Field ${el.field}`;
  if (el.type === "text") return "Text element";
  return "Logo";
}

export function CustomDesignEditor(p: CustomDesignEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<(DragState & { id: string; pointerId: number }) | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const selected = p.design.elements.find((e) => e.id === selectedId) ?? null;
  const page = p.design.page;

  /** px-per-pt scale of the on-screen stage (overlay coords <-> page points). */
  function scale(): number {
    const w = stageRef.current?.clientWidth ?? page.width;
    return w / page.width;
  }

  function update(elements: CustomElement[]) {
    p.onChange({ ...p.design, elements });
  }

  function patchSelected(patch: Partial<CustomElement>) {
    if (!selected) return;
    update(p.design.elements.map((e) => (e.id === selected.id ? ({ ...e, ...patch } as CustomElement) : e)));
  }

  function addField(fieldKey: string) {
    const id = newElementId();
    update([
      ...p.design.elements,
      { id, type: "field", field: fieldKey, x: 40, y: 40, w: Math.min(240, page.width - 80), h: 32, ...DEFAULT_TEXT },
    ]);
    setSelectedId(id);
  }

  function addText() {
    const id = newElementId();
    update([
      ...p.design.elements,
      { id, type: "text", text: "Text", x: 40, y: 88, w: Math.min(200, page.width - 80), h: 28, ...DEFAULT_TEXT, size: 16 },
    ]);
    setSelectedId(id);
  }

  async function addLogo(file: File) {
    try {
      const bytes = await readLogoUpload(file);
      const assetId = newElementId();
      await putAsset(assetId, bytes, "image/png");
      const src = assetSrc("png", bytes);
      p.onAssetAdded(assetId, src);
      const id = newElementId();
      update([...p.design.elements, { id, type: "image", assetId, x: 40, y: 140, w: 96, h: 96 }]);
      setSelectedId(id);
    } catch (e) {
      p.onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function setBackground(file: File) {
    try {
      const { kind, bytes, page: pg } = await readBackgroundUpload(file);
      const assetId = newElementId();
      await putAsset(assetId, bytes, kind === "pdf" ? "application/pdf" : `image/${kind === "jpg" ? "jpeg" : "png"}`);
      p.onAssetAdded(assetId, assetSrc(kind, bytes));
      p.onChange({ ...p.design, page: pg, background: { assetId, kind } });
    } catch (e) {
      p.onError(e instanceof Error ? e.message : String(e));
    }
  }

  function onPointerDown(e: React.PointerEvent, el: CustomElement, mode: "move" | "resize") {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(el.id);
    dragRef.current = { id: el.id, pointerId: e.pointerId, mode, startX: e.clientX, startY: e.clientY, orig: { x: el.x, y: el.y, w: el.w, h: el.h } };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const s = scale();
    const box = applyDrag(d, (e.clientX - d.startX) / s, (e.clientY - d.startY) / s, page);
    update(p.design.elements.map((el) => (el.id === d.id ? { ...el, ...box } : el)));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  const fontOptions: { id: string; label: string }[] = [
    { id: "", label: "Default" },
    ...DESIGNER_FONTS.map((f) => ({ id: f.id, label: f.label })),
    ...listUploadedFonts().map((f) => ({ id: f.id, label: f.label })),
  ];

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap gap-2">
        <label className="btn inline-flex items-center gap-2 cursor-pointer">
          <Upload className="w-4 h-4" strokeWidth={1.75} />
          {p.design.background ? "Replace background" : "Upload background"}
          <input ref={bgInputRef} type="file" accept="image/png,image/jpeg,application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void setBackground(f); e.target.value = ""; }} />
        </label>
        <div className="relative">
          <select className="field" value="" onChange={(e) => { if (e.target.value) addField(e.target.value); }}
            aria-label="Add a merge field">
            <option value="">Add field…</option>
            {p.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <button type="button" className="btn inline-flex items-center gap-2" onClick={addText}>
          <Type className="w-4 h-4" strokeWidth={1.75} /> Add text
        </button>
        <label className="btn inline-flex items-center gap-2 cursor-pointer">
          <ImageIcon className="w-4 h-4" strokeWidth={1.75} /> Add logo
          <input ref={logoInputRef} type="file" accept="image/png,image/jpeg" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void addLogo(f); e.target.value = ""; }} />
        </label>
      </div>

      {/* background-missing degrade */}
      {p.design.background && !p.assets[p.design.background.assetId] && (
        <p className="text-sm text-amber-600">Background image is no longer stored on this device. Re-upload it; your placed elements are kept.</p>
      )}

      {/* stage: live preview + overlay */}
      <div
        ref={stageRef}
        className="relative select-none touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerDown={() => setSelectedId(null)}
      >
        <MergePreview spec={p.spec} row={p.sampleRow} fonts={p.previewFonts} />
        {/* overlay boxes, positioned as % of the stage so they track responsive width */}
        {p.design.elements.map((el) => {
          const sel = el.id === selectedId;
          return (
            <div
              key={el.id}
              role="button"
              tabIndex={0}
              aria-label={elementLabel(el)}
              onPointerDown={(e) => onPointerDown(e, el, "move")}
              className={`absolute cursor-move rounded-sm ${sel ? "ring-2 ring-accent" : "ring-1 ring-black/20 hover:ring-black/40"}`}
              style={{
                left: `${(el.x / page.width) * 100}%`,
                top: `${(el.y / page.height) * 100}%`,
                width: `${(el.w / page.width) * 100}%`,
                height: `${(el.h / page.height) * 100}%`,
              }}
            >
              {sel && (
                <div
                  onPointerDown={(e) => onPointerDown(e, el, "resize")}
                  className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-sm bg-accent cursor-nwse-resize"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* properties panel */}
      {selected && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {selected.type === "field" ? `Field: ${selected.field}` : selected.type === "text" ? "Text" : "Logo"}
            </p>
            <button type="button" className="btn inline-flex items-center gap-2" onClick={() => { update(p.design.elements.filter((e) => e.id !== selected.id)); setSelectedId(null); }}>
              <Trash2 className="w-4 h-4" strokeWidth={1.75} /> Remove
            </button>
          </div>
          {selected.type !== "image" && (
            <div className="grid grid-cols-2 gap-3">
              {selected.type === "text" && (
                <label className="col-span-2 block text-sm font-medium">Text
                  <input className="field mt-1 w-full" value={selected.text} onChange={(e) => patchSelected({ text: e.target.value })} />
                </label>
              )}
              <label className="block text-sm font-medium">Font
                <select className="field mt-1 w-full" value={selected.fontId ?? ""} onChange={(e) => patchSelected({ fontId: e.target.value || undefined })}>
                  {fontOptions.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Size
                <input className="field mt-1 w-full" type="number" min={6} max={200} value={selected.size}
                  onChange={(e) => patchSelected({ size: Math.min(200, Math.max(6, Number(e.target.value) || 6)) })} />
              </label>
              <label className="block text-sm font-medium">Colour
                <input className="field mt-1 w-full h-10" type="color" value={selected.color} onChange={(e) => patchSelected({ color: e.target.value })} />
              </label>
              <div className="block text-sm font-medium">Align
                <div className="mt-1">
                  <Segmented
                    options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]}
                    value={selected.align}
                    onChange={(v) => patchSelected({ align: v as "left" | "center" | "right" })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
