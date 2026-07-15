// Pure helpers for the shared "See past …" panels on the jobDir tools
// (pdf, resize, video, splice, convert, audio). Kept UI-free so they can be unit tested.

export interface ToolRunOutput {
  id: string;
  filename: string;
}

export type PastRunTool = "pdf" | "resize" | "video" | "splice" | "convert" | "audio";

// Extensions each file route serves directly; anything else falls back to the
// route's own default so the link still resolves to a real file.
const RESIZE_EXTS = new Set(["png", "webp"]);
const CONVERT_EXTS = new Set(["zip", "pdf", "png", "jpg", "jpeg", "webp", "mp3", "wav", "m4a"]);

function extOf(filename: string): string {
  return filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
}

// Builds the download URL for a stored run output. The query params mirror
// what each tool's own result card sends its GET file route; extension-driven
// params (pdf's ?kind=zip for split zips, splice's ?kind=audio for m4a) are
// derived from the stored filename.
export function runFileUrl(tool: PastRunTool, output: ToolRunOutput): string {
  const id = encodeURIComponent(output.id);
  const name = encodeURIComponent(output.filename);
  const ext = extOf(output.filename);
  switch (tool) {
    case "pdf":
      return `/api/pdf/file/${id}?name=${name}${ext === "zip" ? "&kind=zip" : ""}`;
    case "resize":
      return `/api/resize/${id}?name=${name}&ext=${RESIZE_EXTS.has(ext) ? ext : "jpg"}`;
    case "video":
      return `/api/video/${id}?name=${name}`;
    case "splice":
      return `/api/splice/${id}?name=${name}${ext === "m4a" ? "&kind=audio" : ""}`;
    case "convert":
    case "audio":
      return `/api/convert/${id}?ext=${CONVERT_EXTS.has(ext) ? ext : "mp3"}&name=${name}`;
  }
}

// Sentence-case badge text for a run's stored mode. Convert's "url" mode reads
// as "Link" to match the tool's own "From link" wording.
export function modeLabel(mode: string | null | undefined): string | null {
  if (!mode) return null;
  if (mode === "url") return "Link";
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
