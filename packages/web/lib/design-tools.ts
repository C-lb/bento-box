/**
 * Shared plumbing for the merge tools' design customisation: slot discovery
 * (which text slots the current layout exposes, for the DesignPanel rows) and
 * font-pool assembly (exactly the fontIds a final spec references, resolved
 * from the curated registry or session uploads, on top of the bundled
 * heading/body fallback).
 */
import type { DocumentSpec } from "@event-editor/core/merge";
import { loadBundledFonts, type FontBytes } from "@/lib/merge-render";
import { loadFontById, getUploadedFont } from "@/lib/designer-fonts";

const SLOT_LABELS: Record<string, string> = {
  title: "Title",
  body: "Body",
  recipient: "Recipient",
  detail: "Detail",
  date: "Date",
  signature: "Signature",
  event: "Event",
  name: "Name",
  org: "Organisation",
  table: "Table",
};

/**
 * Derives the text slots the given layout spec exposes, in element order,
 * deduped, with human labels for the design panel.
 */
export function designSlots(spec: DocumentSpec): { id: string; label: string }[] {
  const seen = new Set<string>();
  const out: { id: string; label: string }[] = [];
  for (const el of spec.elements) {
    if (el.kind !== "text" || !el.slot || seen.has(el.slot)) continue;
    seen.add(el.slot);
    out.push({ id: el.slot, label: SLOT_LABELS[el.slot] ?? el.slot });
  }
  return out;
}

/** Distinct fontIds referenced by a spec, sorted so it can serve as an effect key. */
export function specFontIds(spec: DocumentSpec): string[] {
  const ids = new Set<string>();
  for (const el of spec.elements) {
    if (el.kind === "text" && el.fontId) ids.add(el.fontId);
  }
  return Array.from(ids).sort();
}

/**
 * Builds the font pool for a final (post-applyDesign) spec: the bundled
 * heading/body pair plus bytes for every fontId the spec references
 * (curated ids via the registry, `upload:` ids from the session store).
 * Never throws; missing fonts fall back per element inside the renderer.
 */
export async function withDesignFonts(spec: DocumentSpec): Promise<FontBytes | undefined> {
  let base: FontBytes;
  try {
    base = await loadBundledFonts();
  } catch {
    base = {};
  }
  const byId: Record<string, Uint8Array> = {};
  await Promise.all(
    specFontIds(spec).map(async (id) => {
      try {
        const bytes = id.startsWith("upload:") ? getUploadedFont(id) : await loadFontById(id);
        if (bytes) byId[id] = bytes;
      } catch {
        // unknown or unfetchable font: renderer falls back to the role font
      }
    }),
  );
  if (Object.keys(byId).length === 0) {
    return base.heading || base.body ? base : undefined;
  }
  return { ...base, byId };
}
