import { loadBundledFonts, type FontBytes } from "@/lib/merge-render";

export function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function withFonts(): Promise<FontBytes | undefined> {
  try { return await loadBundledFonts(); } catch { return undefined; }
}
