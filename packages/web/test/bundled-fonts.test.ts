import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { BUNDLED_FONT_PATHS } from "../lib/merge-render";

describe("bundled merge fonts", () => {
  it("every bundled font path maps to a real file under public/", () => {
    for (const p of Object.values(BUNDLED_FONT_PATHS)) {
      const onDisk = resolve(__dirname, "..", "public", "." + p);
      expect(existsSync(onDisk), `${p} missing at ${onDisk}`).toBe(true);
    }
  });
});
