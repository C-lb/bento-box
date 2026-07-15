// packages/web/lib/design-presets.ts
//
// Saved design presets for the merge tools (badge, ticket, place card,
// certificate). A preset captures the CURRENT design mode: a built-in layout
// plus its DesignOverrides, or the full F3 custom-canvas design (asset ids
// keep pointing at the shared ee-design-assets IndexedDB store, so they stay
// valid across sessions; a missing asset is dropped gracefully at apply time
// by customDesignToSpec). Persisted per-browser, per-tool in localStorage,
// mirroring headshot-presets.ts. Kept DOM-free so it can be unit-tested;
// thumbnails live in design-preset-thumb.ts.

import { sanitizeDesignOverrides, type DesignOverrides } from "@event-editor/core/design";
import type { CustomDesign } from "@event-editor/core/custom-design";

const KEY_PREFIX = "ee.designPresets.";

/** What a preset replays: a built-in layout + overrides, or a custom canvas. */
export type DesignPresetCapture =
  | { kind: "design"; layoutId: string; overrides: DesignOverrides }
  | { kind: "custom"; customDesign: CustomDesign };

export type DesignPreset = {
  id: string;
  name: string;
  /** Data-URL thumbnail of the look rendered on sample data. */
  preview: string;
  updatedAt: number;
} & DesignPresetCapture;

function keyFor(toolId: string): string {
  return `${KEY_PREFIX}${toolId}`;
}

// Mirrors custom-design-store's shape check: enough structure to hand the
// value to customDesignToSpec without it exploding.
function isCustomDesign(x: unknown): x is CustomDesign {
  return !!x && typeof x === "object"
    && (x as { v?: unknown }).v === 1
    && Array.isArray((x as { elements?: unknown }).elements)
    && !!(x as { page?: { width?: unknown } }).page;
}

// Sanitize the capture on the way in AND on the way out (defense like
// design-store: hand-edited or stale localStorage never smuggles out-of-range
// values into a render). Returns undefined when the capture is unusable.
function sanitizeCapture(raw: unknown): DesignPresetCapture | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  if (c.kind === "design") {
    if (typeof c.layoutId !== "string" || !c.layoutId) return undefined;
    const overrides = sanitizeDesignOverrides(c.overrides);
    if (!overrides) return undefined;
    return { kind: "design", layoutId: c.layoutId, overrides };
  }
  if (c.kind === "custom") {
    if (!isCustomDesign(c.customDesign)) return undefined;
    return { kind: "custom", customDesign: c.customDesign };
  }
  return undefined;
}

function sanitizeEntry(raw: unknown): DesignPreset | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id || typeof p.name !== "string") return undefined;
  const capture = sanitizeCapture(p);
  if (!capture) return undefined;
  return {
    id: p.id,
    name: p.name,
    preview: typeof p.preview === "string" ? p.preview : "",
    updatedAt: typeof p.updatedAt === "number" && Number.isFinite(p.updatedAt) ? p.updatedAt : 0,
    ...capture,
  };
}

function read(toolId: string): DesignPreset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(keyFor(toolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeEntry).filter((p): p is DesignPreset => !!p);
  } catch {
    return [];
  }
}

function write(toolId: string, list: DesignPreset[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(keyFor(toolId), JSON.stringify(list));
  } catch {
    // Quota or serialization failure: keep the in-memory list, drop the persist.
  }
}

function uid(toolId: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older engines; collisions are irrelevant at this scale.
  return `p_${read(toolId).length}_${Date.now()}`;
}

/** Newest first. */
export function listPresets(toolId: string): DesignPreset[] {
  return read(toolId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getPreset(toolId: string, id: string): DesignPreset | undefined {
  return read(toolId).find((p) => p.id === id);
}

/** Creates a preset from the current look and returns it. */
export function createPreset(
  toolId: string,
  input: { name: string; preview: string; capture: DesignPresetCapture },
): DesignPreset | undefined {
  const capture = sanitizeCapture(input.capture);
  if (!capture) return undefined;
  const preset: DesignPreset = {
    id: uid(toolId),
    name: input.name.trim() || "Untitled preset",
    preview: input.preview,
    updatedAt: Date.now(),
    ...capture,
  };
  write(toolId, [preset, ...read(toolId)]);
  return preset;
}

/**
 * Overwrites an existing preset's fields in place. A new `capture` fully
 * replaces the old one (including a kind switch — stale kind fields never
 * linger).
 */
export function updatePreset(
  toolId: string,
  id: string,
  patch: { name?: string; preview?: string; capture?: DesignPresetCapture },
): DesignPreset | undefined {
  const list = read(toolId);
  const i = list.findIndex((p) => p.id === id);
  if (i === -1) return undefined;
  const prev = list[i];
  let capture: DesignPresetCapture =
    prev.kind === "design"
      ? { kind: "design", layoutId: prev.layoutId, overrides: prev.overrides }
      : { kind: "custom", customDesign: prev.customDesign };
  if (patch.capture !== undefined) {
    const next = sanitizeCapture(patch.capture);
    if (!next) return undefined;
    capture = next;
  }
  const updated: DesignPreset = {
    id: prev.id,
    name: patch.name !== undefined ? patch.name.trim() || "Untitled preset" : prev.name,
    preview: patch.preview !== undefined ? patch.preview : prev.preview,
    updatedAt: Date.now(),
    ...capture,
  };
  list[i] = updated;
  write(toolId, list);
  return updated;
}

export function renamePreset(toolId: string, id: string, name: string): DesignPreset | undefined {
  return updatePreset(toolId, id, { name });
}

export function deletePreset(toolId: string, id: string): void {
  write(toolId, read(toolId).filter((p) => p.id !== id));
}

/**
 * Session-uploaded font ids (`upload:` prefix) a capture references. Uploads
 * are never persisted, so presets keep the id only — the renderer falls back
 * to a bundled font when the id can't be resolved. Used by DesignPresetBar
 * for its quiet "uploaded fonts are not saved with presets" note.
 */
export function captureUploadFontIds(capture: DesignPresetCapture): string[] {
  const ids = new Set<string>();
  if (capture.kind === "design") {
    for (const style of Object.values(capture.overrides.text ?? {})) {
      if (style.fontId?.startsWith("upload:")) ids.add(style.fontId);
    }
  } else {
    for (const el of capture.customDesign.elements) {
      if (el.type !== "image" && el.fontId?.startsWith("upload:")) ids.add(el.fontId);
    }
  }
  return Array.from(ids);
}
