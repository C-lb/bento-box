"use client";
import { useEffect, useRef, useState } from "react";
import { getFrame, type HeadshotStyle } from "@event-editor/core/frames";
import { drawCard, loadCardFont } from "@/lib/headshot-canvas-draw";

// Live, in-browser proxy of the server render. Geometry + fonts come from the
// shared modules (headshot-layout, headshot-canvas-draw) so it tracks the
// exported PNG closely. The PNG remains authoritative.

interface Props {
  frameId: string;
  photoUrl: string | null;
  nameText: string;
  titleText: string;
  style: HeadshotStyle;
  /** Pan changes from dragging the photo, as normalized -1..1 offsets. */
  onPan?: (offsetX: number, offsetY: number) => void;
}

export function PreviewCanvas({ frameId, photoUrl, nameText, titleText, style, onPan }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const frame = getFrame(frameId);

  useEffect(() => {
    setImgReady(false);
    if (!photoUrl) { imgRef.current = null; return; }
    const img = new Image();
    img.onload = () => { imgRef.current = img; setImgReady(true); };
    img.onerror = () => { imgRef.current = null; setImgReady(false); };
    img.src = photoUrl;
  }, [photoUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    (async () => {
      const family = await loadCardFont(style);
      if (cancelled) return;
      drawCard(ctx, frame, imgRef.current, nameText, titleText, style, family);
    })();
    return () => { cancelled = true; };
  }, [frame, nameText, titleText, style, imgReady]);

  if (!frame) return null;
  const C = frame.canvas;
  const canPan = frame.photo.shape === "circle" && (style.zoom ?? 1) > 1;

  function toOffsetDelta(clientDx: number, clientDy: number) {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return { dx: 0, dy: 0 };
    const scale = C / canvas.getBoundingClientRect().width;
    const z = style.zoom ?? 1;
    const slackX = (z - 1) * frame.photo.w;
    const slackY = (z - 1) * frame.photo.h;
    return {
      dx: slackX > 0 ? (-2 * clientDx * scale) / slackX : 0,
      dy: slackY > 0 ? (-2 * clientDy * scale) / slackY : 0,
    };
  }

  return (
    <canvas
      ref={canvasRef}
      width={C}
      height={C}
      className="w-full max-w-80 rounded-xl border border-line"
      style={{ touchAction: canPan ? "none" : undefined, cursor: canPan ? "grab" : "default" }}
      onPointerDown={(e) => {
        if (!canPan) return;
        drag.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        (e.target as HTMLElement).style.cursor = "grabbing";
      }}
      onPointerMove={(e) => {
        if (!drag.current || !onPan) return;
        const { dx, dy } = toOffsetDelta(e.clientX - drag.current.x, e.clientY - drag.current.y);
        drag.current = { x: e.clientX, y: e.clientY };
        const nx = Math.max(-1, Math.min(1, (style.offsetX ?? 0) + dx));
        const ny = Math.max(-1, Math.min(1, (style.offsetY ?? 0) + dy));
        onPan(nx, ny);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        (e.target as HTMLElement).style.cursor = "grab";
      }}
      aria-label="Headshot preview"
    />
  );
}
