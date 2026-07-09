/**
 * Designer font registry: a curated set of bundled OFL fonts, plus
 * session-scoped user uploads. Fonts resolve to raw bytes so callers can
 * feed them into `FontBytes.byId` for PDF embedding (see merge-render.ts).
 */

export type DesignerFontCategory = "sans" | "serif" | "script" | "display" | "mono";

export interface DesignerFont {
  id: string;
  label: string;
  file: string;
  category: DesignerFontCategory;
}

/**
 * Curated bundle. Files live in `public/fonts/designer/`. Families shipped
 * upstream as a single variable-font file (Inter, DM Sans, Playfair
 * Display, Cormorant Garamond, Oswald) have a "regular" entry plus a
 * "-bold" entry pinned to wght=700 and re-exported as a static TTF — see
 * `public/fonts/designer/LICENSES.md` for details. Great Vibes has no bold
 * (the upstream family doesn't define one).
 */
export const DESIGNER_FONTS: DesignerFont[] = [
  { id: "inter", label: "Inter", file: "inter-regular.ttf", category: "sans" },
  { id: "inter-bold", label: "Inter Bold", file: "inter-bold.ttf", category: "sans" },
  { id: "dm-sans", label: "DM Sans", file: "dm-sans-regular.ttf", category: "sans" },
  { id: "dm-sans-bold", label: "DM Sans Bold", file: "dm-sans-bold.ttf", category: "sans" },
  {
    id: "playfair-display",
    label: "Playfair Display",
    file: "playfair-display-regular.ttf",
    category: "serif",
  },
  {
    id: "playfair-display-bold",
    label: "Playfair Display Bold",
    file: "playfair-display-bold.ttf",
    category: "serif",
  },
  {
    id: "cormorant-garamond",
    label: "Cormorant Garamond",
    file: "cormorant-garamond-regular.ttf",
    category: "serif",
  },
  {
    id: "cormorant-garamond-bold",
    label: "Cormorant Garamond Bold",
    file: "cormorant-garamond-bold.ttf",
    category: "serif",
  },
  { id: "great-vibes", label: "Great Vibes", file: "great-vibes-regular.ttf", category: "script" },
  { id: "oswald", label: "Oswald", file: "oswald-regular.ttf", category: "display" },
  { id: "oswald-bold", label: "Oswald Bold", file: "oswald-bold.ttf", category: "display" },
  { id: "space-mono", label: "Space Mono", file: "space-mono-regular.ttf", category: "mono" },
  { id: "space-mono-bold", label: "Space Mono Bold", file: "space-mono-bold.ttf", category: "mono" },
];

const fontCache = new Map<string, Uint8Array>();

/**
 * Fetches a curated designer font's bytes by registry id, caching the
 * result in memory so repeated lookups (e.g. re-rendering a document) skip
 * the network round-trip.
 */
export async function loadFontById(id: string): Promise<Uint8Array> {
  const cached = fontCache.get(id);
  if (cached) return cached;

  const entry = DESIGNER_FONTS.find((f) => f.id === id);
  if (!entry) {
    throw new Error(`Unknown designer font id: ${id}`);
  }

  const res = await fetch(`/fonts/designer/${entry.file}`);
  if (!res.ok) {
    throw new Error(`Failed to load font "${id}": ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  fontCache.set(id, buf);
  return buf;
}

// --- Session-only uploaded fonts ---------------------------------------

interface UploadedFont {
  id: string;
  label: string;
  bytes: Uint8Array;
}

/** Module-level, session-only store. Cleared on reload; never persisted. */
const uploadedFonts = new Map<string, UploadedFont>();

/**
 * Registers an uploaded font for this session and returns its registry id
 * (`upload:<name>`). Re-uploading the same name overwrites the previous
 * bytes under the same id.
 */
export function addUploadedFont(name: string, bytes: Uint8Array): string {
  const id = `upload:${name}`;
  uploadedFonts.set(id, { id, label: name, bytes });
  return id;
}

/** Lists fonts uploaded during this session, for display alongside curated fonts. */
export function listUploadedFonts(): { id: string; label: string }[] {
  return Array.from(uploadedFonts.values()).map(({ id, label }) => ({ id, label }));
}

/** Returns the bytes for a previously uploaded font, or undefined if unknown. */
export function getUploadedFont(id: string): Uint8Array | undefined {
  return uploadedFonts.get(id)?.bytes;
}
