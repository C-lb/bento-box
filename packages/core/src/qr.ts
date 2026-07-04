export type QrEcc = "L" | "M" | "Q" | "H";
export type QrFormat = "png" | "svg";

function hexOr(v: unknown, fallback: string): string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}

export function normalizeQrOpts(raw: {
  size?: unknown; ecc?: string; fg?: unknown; bg?: unknown; format?: string;
}): { size: number; ecc: QrEcc; fg: string; bg: string; format: QrFormat } {
  const s = Number.isFinite(Number(raw.size)) ? Math.round(Number(raw.size)) : 512;
  const ecc: QrEcc =
    raw.ecc === "L" || raw.ecc === "Q" || raw.ecc === "H" ? raw.ecc : "M";
  const format: QrFormat = raw.format === "svg" ? "svg" : "png";
  return {
    size: Math.min(1024, Math.max(128, s)),
    ecc,
    fg: hexOr(raw.fg, "#000000"),
    bg: hexOr(raw.bg, "#ffffff"),
    format,
  };
}
