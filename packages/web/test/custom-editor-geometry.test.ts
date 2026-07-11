import { describe, it, expect } from "vitest";
import { applyDrag, type DragState } from "../components/custom-editor-geometry";

const page = { width: 400, height: 300 };
const orig = { x: 40, y: 40, w: 80, h: 40 };

describe("applyDrag", () => {
  it("move: offsets and snaps to the 8pt grid", () => {
    const s: DragState = { mode: "move", startX: 0, startY: 0, orig };
    expect(applyDrag(s, 13, 5, page)).toEqual({ x: 56, y: 48, w: 80, h: 40 });
  });
  it("move: clamps inside the page", () => {
    const s: DragState = { mode: "move", startX: 0, startY: 0, orig };
    expect(applyDrag(s, -999, -999, page)).toEqual({ x: 0, y: 0, w: 80, h: 40 });
    expect(applyDrag(s, 999, 999, page)).toEqual({ x: 320, y: 260, w: 80, h: 40 });
  });
  it("resize: grows from the bottom-right handle with an 8pt floor", () => {
    const s: DragState = { mode: "resize", startX: 0, startY: 0, orig };
    expect(applyDrag(s, 21, 10, page)).toEqual({ x: 40, y: 40, w: 104, h: 48 });
    expect(applyDrag(s, -999, -999, page)).toEqual({ x: 40, y: 40, w: 8, h: 8 });
  });
  it("resize: cannot extend past the page edge", () => {
    const s: DragState = { mode: "resize", startX: 0, startY: 0, orig };
    expect(applyDrag(s, 9999, 9999, page)).toEqual({ x: 40, y: 40, w: 360, h: 260 });
  });
});
