import { describe, it, expect } from "vitest";
import { safeBase, swapExt } from "../src/names.js";

describe("safeBase", () => {
  it("strips unsafe chars and collapses runs", () => {
    // safeBase does not strip extensions (that is swapExt's job), so the
    // trailing ".png" survives, joined by the underscore from the "*?" run.
    expect(safeBase("../a/b:c*?.png")).toBe("a_b_c_.png");
  });
  it("keeps a plain base", () => {
    expect(safeBase("holiday photo")).toBe("holiday_photo");
  });
  it("falls back to empty for all-unsafe input", () => {
    expect(safeBase("///")).toBe("");
  });
});

describe("swapExt", () => {
  it("replaces an existing extension", () => {
    expect(swapExt("IMG_1234.HEIC", "jpg")).toBe("IMG_1234.jpg");
  });
  it("appends when there is no extension", () => {
    expect(swapExt("clip", "mp4")).toBe("clip.mp4");
  });
  it("sanitises the base", () => {
    expect(swapExt("my file:v2.heic", "png")).toBe("my_file_v2.png");
  });
});
