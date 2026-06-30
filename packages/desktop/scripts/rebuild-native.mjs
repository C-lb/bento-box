// packages/desktop/scripts/rebuild-native.mjs
import { rebuild } from "@electron/rebuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { writeFileSync, existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronVersion = require("electron/package.json").version;
const buildPath = resolve(here, "../build/server");   // rebuild the assembled server's node_modules

// @electron/rebuild requires a package.json at buildPath; the standalone output does not include one.
const stubPkg = resolve(buildPath, "package.json");
if (!existsSync(stubPkg)) {
  writeFileSync(stubPkg, JSON.stringify({ name: "event-editor-server", version: "0.0.1", private: true }));
}

await rebuild({
  buildPath,
  electronVersion,
  onlyModules: ["better-sqlite3", "sharp"],
  force: true,
});
console.log("rebuilt native modules for electron", electronVersion);
