import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readPid, writePid, clearPid, isAlive } = require("../lib/pidfile.js");

const dir = mkdtempSync(join(tmpdir(), "ee-pidfile-"));

test("readPid returns the recorded pid", () => {
  const f = join(dir, "a.pid");
  writePid(f, 12345);
  assert.equal(readPid(f), 12345);
});

test("readPid is null for missing, junk, zero, or negative content", () => {
  assert.equal(readPid(join(dir, "missing.pid")), null);
  const f = join(dir, "junk.pid");
  writeFileSync(f, "not a pid");
  assert.equal(readPid(f), null);
  writeFileSync(f, "0");
  assert.equal(readPid(f), null);
  writeFileSync(f, "-5");
  assert.equal(readPid(f), null);
});

test("clearPid removes the file and tolerates a missing one", () => {
  const f = join(dir, "c.pid");
  writePid(f, 99);
  clearPid(f);
  assert.equal(readPid(f), null);
  clearPid(f); // second call must not throw
});

test("isAlive reflects signal-0 success and failure", () => {
  assert.equal(isAlive(123, () => {}), true);
  assert.equal(
    isAlive(123, () => {
      throw new Error("ESRCH");
    }),
    false,
  );
  assert.equal(isAlive(process.pid), true);
});
