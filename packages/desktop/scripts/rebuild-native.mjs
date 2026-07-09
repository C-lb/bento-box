// packages/desktop/scripts/rebuild-native.mjs
// Rebuilds the assembled server's native addons (better-sqlite3, sharp) for
// Electron's ABI. The forked Next server and migrate step run under
// ELECTRON_RUN_AS_NODE, so the addons MUST match Electron's NODE_MODULE_VERSION,
// not the system Node that npm installed them with.
import { rebuild } from "@electron/rebuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronVersion = require("electron/package.json").version;
const electronBin = require("electron"); // resolves to the Electron executable path
const buildPath = resolve(here, "../build/server"); // rebuild the assembled server's node_modules
// better-sqlite3 is a NODE_MODULE_VERSION addon and MUST be recompiled for
// Electron's ABI. sharp is prebuilt N-API (ABI-stable across Node/Electron), so it
// only needs its platform .node shipped (handled in assemble-server.mjs), not a
// rebuild - @electron/rebuild can't build it from source anyway. Verify both load.
const REBUILD = ["better-sqlite3"];
const VERIFY = ["better-sqlite3", "sharp", "@napi-rs/canvas"];

// @electron/rebuild requires a package.json at buildPath; the Next standalone
// output ships none. It also walks the dependency tree to find addons, so the
// stub MUST list the native deps or onlyModules filters an empty set and
// NOTHING gets rebuilt (the addon then ships at the system-Node ABI and fails
// to dlopen under Electron at runtime).
writeFileSync(
  resolve(buildPath, "package.json"),
  JSON.stringify(
    {
      name: "event-editor-server",
      version: "0.0.1",
      private: true,
      dependencies: Object.fromEntries(REBUILD.map((m) => [m, "*"])),
    },
    null,
    2,
  ),
);

await rebuild({
  buildPath,
  electronVersion,
  onlyModules: REBUILD,
  force: true,
});
console.log("rebuilt native modules for electron", electronVersion);

// Assert the rebuild actually produced Electron-ABI binaries by loading each
// addon under Electron-as-node. A silent no-op rebuild (the original bug) would
// pass the build but crash the app on first db/image use; fail the build here
// instead.
for (const mod of VERIFY) {
  const modPath = resolve(buildPath, "node_modules", mod);
  const probe =
    mod === "better-sqlite3"
      ? `const D = require(${JSON.stringify(modPath)}); new D(":memory:").close(); console.log("ok");`
      : `require(${JSON.stringify(modPath)}); console.log("ok");`;
  const res = spawnSync(electronBin, ["-e", probe], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
  });
  if (res.status !== 0 || !String(res.stdout).includes("ok")) {
    throw new Error(
      `${mod} failed to load under Electron after rebuild (ABI mismatch). stderr:\n${res.stderr || res.error}`,
    );
  }
  console.log(`verified ${mod} loads under electron`);
}
