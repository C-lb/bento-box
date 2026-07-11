import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { resolveDirs } = require("../lib/dirs.js");

test("defaults to userData/data and dataDir/bin", () => {
  const { dataDir, binDir } = resolveDirs({}, "/Users/x/Library/Application Support/Bento");
  assert.equal(dataDir, path.join("/Users/x/Library/Application Support/Bento", "data"));
  assert.equal(binDir, path.join(dataDir, "bin"));
});

test("EE_DATA_DIR override wins and binDir follows it", () => {
  const { dataDir, binDir } = resolveDirs({ EE_DATA_DIR: "/tmp/ee-data" }, "/ignored");
  assert.equal(dataDir, path.resolve("/tmp/ee-data"));
  assert.equal(binDir, path.join(path.resolve("/tmp/ee-data"), "bin"));
});

test("EE_BIN_DIR override wins independently", () => {
  const { binDir } = resolveDirs({ EE_BIN_DIR: "/opt/ee-bin" }, "/u");
  assert.equal(binDir, path.resolve("/opt/ee-bin"));
});
