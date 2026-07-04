import { swapExt } from "./names.js";

export type BgFill = "transparent" | { color: string };

export function cutoutOutName(srcName: string): string {
  // Background removal always outputs PNG (alpha). Name it <base>-cutout.png.
  const withoutExt = srcName.replace(/\.[a-z0-9]{1,5}$/i, "");
  return swapExt(`${withoutExt}-cutout`, "png");
}

export function normalizeBgFill(raw: { mode?: string; color?: string }): BgFill {
  if (raw.mode === "white") return { color: "#ffffff" };
  if (raw.mode === "custom") {
    return typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color)
      ? { color: raw.color.toLowerCase() }
      : "transparent";
  }
  return "transparent";
}
