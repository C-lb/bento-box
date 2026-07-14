import { describe, it, expect } from "vitest";
import { FRAMES } from "@event-editor/core/frames";
import type { HeadshotStyle } from "@event-editor/core/frames";
import { textLines, photoCrop, rimGeometry } from "./headshot-layout";

const circle = FRAMES.circle;
const band = FRAMES["clean-band"];

describe("textLines", () => {
  it("places name and title on their frame positions by default (back-compat)", () => {
    const lines = textLines(circle, undefined, { name: "David", title: "CEO" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ key: "name", yTop: circle.name.y, size: circle.name.size });
    expect(lines[1]).toMatchObject({ key: "title", yTop: circle.title.y, size: circle.title.size });
  });

  it("omits the company line when empty", () => {
    const lines = textLines(circle, { companyText: "" }, { name: "D", title: "C", company: "" });
    expect(lines.map((l) => l.key)).toEqual(["name", "title"]);
  });

  it("stacks the company line beneath the title using the frame gap", () => {
    const lines = textLines(circle, undefined, { name: "D", title: "C", company: "SPARK" });
    expect(lines.map((l) => l.key)).toEqual(["name", "title", "company"]);
    const gap = circle.title.y - circle.name.y - circle.name.size;
    expect(lines[2].yTop).toBe(circle.title.y + circle.title.size + gap);
    // company borrows the title's x/anchor
    expect(lines[2].x).toBe(circle.title.x);
    expect(lines[2].anchor).toBe(circle.title.anchor);
  });

  it("lineGap widens the space between every line", () => {
    const lines = textLines(circle, { lineGap: 10 }, { name: "D", title: "C", company: "S" });
    expect(lines[1].yTop).toBe(circle.title.y + 10); // title pushed down by one extra gap
    expect(lines[2].yTop).toBe(circle.title.y + circle.title.size + (circle.title.y - circle.name.y - circle.name.size) + 20);
  });

  it("textOffsetY shifts the whole block down from the photo", () => {
    const lines = textLines(circle, { textOffsetY: 30 }, { name: "D", title: "C" });
    expect(lines[0].yTop).toBe(circle.name.y + 30);
    expect(lines[1].yTop).toBe(circle.title.y + 30);
  });

  it("growing name size pushes lines below it down", () => {
    const style: HeadshotStyle = { name: { size: circle.name.size + 20 } };
    const lines = textLines(circle, style, { name: "D", title: "C" });
    expect(lines[1].yTop).toBe(circle.title.y + 20);
  });

  it("resolves per-line bold/italic over the card-level legacy fields", () => {
    const style: HeadshotStyle = { bold: true, title: { bold: false } };
    const lines = textLines(circle, style, { name: "D", title: "C" });
    expect(lines[0].bold).toBe(true); // inherits card-level
    expect(lines[1].bold).toBe(false); // per-line override wins
  });

  it("applies uppercase and colour overrides", () => {
    const style: HeadshotStyle = { uppercase: true, color: "#ff0000" };
    const lines = textLines(circle, style, { name: "David", title: "ceo" });
    expect(lines[0].text).toBe("DAVID");
    expect(lines[1].color).toBe("#ff0000");
  });

  it("carries tracking through per-line", () => {
    const lines = textLines(circle, { name: { tracking: 4 } }, { name: "D", title: "C" });
    expect(lines[0].tracking).toBe(4);
    expect(lines[1].tracking).toBe(0);
  });
});

describe("photoCrop", () => {
  it("has no slack at zoom 1, so pan is ignored", () => {
    const c = photoCrop(620, 620, 1, -1, 1);
    expect(c.zw).toBe(620);
    expect(c.extractLeft).toBe(0);
    expect(c.extractTop).toBe(0);
  });

  it("centres the extract at zoom > 1 with no pan", () => {
    const c = photoCrop(620, 620, 2, 0, 0);
    expect(c.zw).toBe(1240);
    expect(c.extractLeft).toBe(310); // (1240-620)/2
    expect(c.extractTop).toBe(310);
  });

  it("pans to the edges within the slack", () => {
    const left = photoCrop(620, 620, 2, -1, 0);
    expect(left.extractLeft).toBe(0);
    const right = photoCrop(620, 620, 2, 1, 0);
    expect(right.extractLeft).toBe(620); // zw - slotW = 1240-620
  });

  it("clamps zoom into [1, 3]", () => {
    expect(photoCrop(100, 100, 9).zw).toBe(300);
    expect(photoCrop(100, 100, 0).zw).toBe(100);
  });
});

describe("rimGeometry", () => {
  it("returns undefined for non-circle frames", () => {
    expect(rimGeometry(band, { mode: "solid", width: 10, color: "#000000" })).toBeUndefined();
  });

  it("returns undefined when no rim requested", () => {
    expect(rimGeometry(circle, undefined)).toBeUndefined();
  });

  it("centres the ring on the photo and insets by half the width", () => {
    const g = rimGeometry(circle, { mode: "solid", width: 20, color: "#000000" })!;
    expect(g.cx).toBe(circle.photo.x + circle.photo.w / 2);
    expect(g.cy).toBe(circle.photo.y + circle.photo.h / 2);
    expect(g.ringRadius).toBe(circle.photo.w / 2 - 10);
    expect(g.gradient).toBeUndefined();
  });

  it("clamps width to [2, 80]", () => {
    expect(rimGeometry(circle, { mode: "solid", width: 999 })!.width).toBe(80);
    expect(rimGeometry(circle, { mode: "solid", width: 0 })!.width).toBe(2);
  });

  it("computes horizontal gradient endpoints at angle 0", () => {
    const g = rimGeometry(circle, { mode: "gradient", width: 10, from: "#f0f", to: "#00f", angle: 0 })!;
    const r = circle.photo.w / 2;
    expect(g.gradient!.x1).toBeCloseTo(g.cx - r);
    expect(g.gradient!.x2).toBeCloseTo(g.cx + r);
    expect(g.gradient!.y1).toBeCloseTo(g.cy);
    expect(g.gradient!.y2).toBeCloseTo(g.cy);
  });

  it("computes vertical gradient endpoints at angle 90", () => {
    const g = rimGeometry(circle, { mode: "gradient", width: 10, from: "#f0f", to: "#00f", angle: 90 })!;
    const r = circle.photo.w / 2;
    expect(g.gradient!.y1).toBeCloseTo(g.cy - r);
    expect(g.gradient!.y2).toBeCloseTo(g.cy + r);
    expect(g.gradient!.x1).toBeCloseTo(g.cx);
  });
});
