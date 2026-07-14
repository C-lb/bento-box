// packages/web/lib/headshot-preset-thumb.ts
"use client";
import { getFrame, type HeadshotStyle } from "@event-editor/core/frames";
import { drawCard, loadCardFont } from "./headshot-canvas-draw";

const THUMB = 256;

/**
 * Renders a preset's look to a small PNG data URL on a stand-in silhouette
 * (no real photo), for the preset card preview. Downscaled so the string stays
 * small in localStorage.
 */
export async function renderPresetThumb(frameId: string, style: HeadshotStyle): Promise<string> {
  const frame = getFrame(frameId);
  if (typeof document === "undefined" || !frame) return "";
  const family = await loadCardFont(style);

  const full = document.createElement("canvas");
  full.width = frame.canvas;
  full.height = frame.canvas;
  const fctx = full.getContext("2d");
  if (!fctx) return "";
  // Ignore pan/zoom in the thumb: the silhouette has no real photo to reposition.
  drawCard(fctx, frame, null, "Name", "Title", { ...style, zoom: 1, offsetX: 0, offsetY: 0 }, family);

  const thumb = document.createElement("canvas");
  thumb.width = THUMB;
  thumb.height = THUMB;
  const tctx = thumb.getContext("2d");
  if (!tctx) return "";
  tctx.imageSmoothingQuality = "high";
  tctx.drawImage(full, 0, 0, THUMB, THUMB);
  return thumb.toDataURL("image/png");
}
