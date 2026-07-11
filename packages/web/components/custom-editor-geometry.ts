import type { PageSize } from "@event-editor/core/merge";

export interface DragState {
  mode: "move" | "resize";
  startX: number;
  startY: number;
  orig: { x: number; y: number; w: number; h: number };
}

const GRID = 8;
const MIN = 8;
const snap = (v: number) => Math.round(v / GRID) * GRID;

/** Applies a pointer delta (in page points) to a box, clamping to the page and an 8pt minimum size, snapping to an 8pt grid. */
export function applyDrag(
  state: DragState,
  dxPt: number,
  dyPt: number,
  page: PageSize,
): { x: number; y: number; w: number; h: number } {
  const { orig } = state;
  if (state.mode === "move") {
    const x = Math.min(Math.max(snap(orig.x + dxPt), 0), page.width - orig.w);
    const y = Math.min(Math.max(snap(orig.y + dyPt), 0), page.height - orig.h);
    return { x, y, w: orig.w, h: orig.h };
  }
  const w = Math.min(Math.max(snap(orig.w + dxPt), MIN), page.width - orig.x);
  const h = Math.min(Math.max(snap(orig.h + dyPt), MIN), page.height - orig.y);
  return { x: orig.x, y: orig.y, w, h };
}
