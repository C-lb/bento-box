import { describe, it, expect } from "vitest";
import { navShouldAnimate, bestMatchIndex, shouldUnsettle } from "@/components/nav-anim";

const HREFS = ["/", "/sorter", "/transcribe", "/studio", "/slice", "/settings"];

describe("navShouldAnimate", () => {
  it("does not animate on first mount (prev null)", () => {
    expect(navShouldAnimate(null, "/")).toBe(false);
  });
  it("does not animate when the route is unchanged", () => {
    expect(navShouldAnimate("/", "/")).toBe(false);
  });
  it("animates when the route changes", () => {
    expect(navShouldAnimate("/", "/slice")).toBe(true);
  });
});

describe("bestMatchIndex", () => {
  it("matches home exactly", () => {
    expect(bestMatchIndex(HREFS, "/")).toBe(0);
  });
  it("matches a top-level route", () => {
    expect(bestMatchIndex(HREFS, "/slice")).toBe(4);
  });
  it("matches a nested path to its prefix (studio subpaths route to studio)", () => {
    expect(bestMatchIndex(HREFS, "/studio/batch")).toBe(3);
  });
  it("does not treat home as a prefix of everything", () => {
    expect(bestMatchIndex(HREFS, "/sorter")).toBe(1);
  });
  it("returns -1 when nothing matches", () => {
    expect(bestMatchIndex(HREFS, "/nonexistent")).toBe(-1);
  });
});

describe("shouldUnsettle", () => {
  it("unsettles when the active index changes during an animated nav", () => {
    expect(shouldUnsettle(0, 3, true)).toBe(true);
  });
  it("stays settled when the path changes but the active index does not (within-tab nav)", () => {
    expect(shouldUnsettle(3, 3, true)).toBe(false);
  });
  it("stays settled when not animating (reduced motion / snap)", () => {
    expect(shouldUnsettle(0, 3, false)).toBe(false);
  });
});
