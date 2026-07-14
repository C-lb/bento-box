// packages/web/lib/headshot-presets.ts
//
// Saved headshot look presets. A preset captures the frame + the visual style
// (font, per-line, colours, rim, spacing, transparent bg) so one look can be
// replayed across many people. It never stores the photo, name, or title.
// Company text is stored only when the user opts to bake it in (includeCompany).
// Persisted per-browser in localStorage, matching how the merge tools keep
// designs. Kept DOM-free so it can be unit-tested; thumbnails live in
// headshot-preset-thumb.ts.

import type { HeadshotStyle } from "@event-editor/core/frames";

const KEY = "ee.headshotPresets";

export interface HeadshotPreset {
  id: string;
  name: string;
  frameId: string;
  /** Visual style. Includes companyText only when includeCompany is true. */
  style: HeadshotStyle;
  includeCompany: boolean;
  /** Data-URL thumbnail rendered on a stand-in silhouette. */
  preview: string;
  updatedAt: number;
}

function read(): HeadshotPreset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HeadshotPreset[]) : [];
  } catch {
    return [];
  }
}

function write(list: HeadshotPreset[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota or serialization failure: keep the in-memory list, drop the persist.
  }
}

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older engines; collisions are irrelevant at this scale.
  return `p_${read().length}_${Date.now()}`;
}

/** Newest first. */
export function listPresets(): HeadshotPreset[] {
  return read().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getPreset(id: string): HeadshotPreset | undefined {
  return read().find((p) => p.id === id);
}

/** Creates a preset and returns it. Strips companyText unless includeCompany. */
export function createPreset(input: {
  name: string;
  frameId: string;
  style: HeadshotStyle;
  includeCompany: boolean;
  preview: string;
}): HeadshotPreset {
  const style = { ...input.style };
  if (!input.includeCompany) delete style.companyText;
  const preset: HeadshotPreset = {
    id: uid(),
    name: input.name.trim() || "Untitled preset",
    frameId: input.frameId,
    style,
    includeCompany: input.includeCompany,
    preview: input.preview,
    updatedAt: Date.now(),
  };
  write([preset, ...read()]);
  return preset;
}

/** Overwrites an existing preset's fields in place. */
export function updatePreset(
  id: string,
  patch: Partial<Pick<HeadshotPreset, "name" | "frameId" | "style" | "includeCompany" | "preview">>,
): HeadshotPreset | undefined {
  const list = read();
  const i = list.findIndex((p) => p.id === id);
  if (i === -1) return undefined;
  const next = { ...list[i], ...patch, updatedAt: Date.now() };
  if (patch.style !== undefined || patch.includeCompany !== undefined) {
    const style = { ...next.style };
    if (!next.includeCompany) delete style.companyText;
    next.style = style;
  }
  list[i] = next;
  write(list);
  return next;
}

export function renamePreset(id: string, name: string): HeadshotPreset | undefined {
  return updatePreset(id, { name: name.trim() || "Untitled preset" });
}

export function deletePreset(id: string): void {
  write(read().filter((p) => p.id !== id));
}
