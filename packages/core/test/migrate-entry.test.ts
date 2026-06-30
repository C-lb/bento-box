import { describe, it, expect } from "vitest";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../src/migrate.js";

// Regression: the packaged desktop app lives under ".../Event Editor.app/...".
// import.meta.url percent-encodes the space (Event%20Editor.app), but the old
// guard built the comparison URL as `file://${process.argv[1]}` with a literal
// space, so it never matched in the bundle and migrations were silently skipped
// (empty db -> /settings threw on first read). isMainModule must compare via
// pathToFileURL so the encoding matches on both sides.
describe("isMainModule (migrate CLI entry detection)", () => {
  it("is true when argv1 is this module's plain path", () => {
    const p = "/home/user/core/dist/migrate.js";
    expect(isMainModule(pathToFileURL(p).href, p)).toBe(true);
  });

  it("is true when the path contains a space (packaged app bundle)", () => {
    const p = "/Users/x/Event Editor.app/Contents/Resources/server/migrate.js";
    expect(isMainModule(pathToFileURL(p).href, p)).toBe(true);
  });

  it("is false when imported (argv1 is a different entry)", () => {
    const meta = pathToFileURL("/home/user/core/dist/migrate.js").href;
    expect(isMainModule(meta, "/home/user/core/dist/server.js")).toBe(false);
  });

  it("is false when argv1 is undefined", () => {
    expect(isMainModule("file:///home/user/core/dist/migrate.js", undefined)).toBe(false);
  });
});
