// packages/desktop/scripts/assemble-server.mjs
// Assembles a self-contained, runnable Next server tree into build/server.
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");                 // monorepo root
const web = resolve(repo, "packages/web");
const standalone = resolve(web, ".next/standalone");
const out = resolve(here, "../build/server");

// Single guard for standalone: covers both missing dir and missing server.js.
if (!existsSync(standalone) || !existsSync(resolve(standalone, "packages/web/server.js"))) {
  console.error(`Next standalone output not found or incomplete at ${standalone}. Run \`npm -w @event-editor/web run build\` (needs output:"standalone") before assembling.`);
  process.exit(1);
}

// Guard: core must be built before assemble so its dist is available to copy.
if (!existsSync(resolve(repo, "packages/core/dist/migrate.js"))) {
  console.error("packages/core/dist/migrate.js not found - run `npm -w @event-editor/core run build` first.");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. the whole standalone tree (server.js + traced node_modules, incl. @event-editor/core + native deps)
cpSync(standalone, out, { recursive: true });
// 2. static assets Next does not copy into standalone
cpSync(resolve(web, ".next/static"), resolve(out, "packages/web/.next/static"), { recursive: true });
if (existsSync(resolve(web, "public"))) {
  cpSync(resolve(web, "public"), resolve(out, "packages/web/public"), { recursive: true });
}
// 3. the font (read from disk at runtime via EE_FONT_PATH)
cpSync(resolve(web, "assets/fonts"), resolve(out, "packages/web/assets/fonts"), { recursive: true });

// 4. @event-editor/core is bundled into the .next chunks (not in serverExternalPackages),
// so output-file-tracing does not emit it. main.js forks core's migrate.js by file path,
// so copy core's dist + manifest into the server node_modules explicitly.
// Deps (drizzle-orm, better-sqlite3) resolve via the sibling build/server/node_modules.
cpSync(resolve(repo, "packages/core/dist"), resolve(out, "node_modules/@event-editor/core/dist"), { recursive: true });
cpSync(resolve(repo, "packages/core/package.json"), resolve(out, "node_modules/@event-editor/core/package.json"));

// Post-assembly assertion: the forked migrate entry MUST exist or migrations fail at launch.
if (!existsSync(resolve(out, "node_modules/@event-editor/core/dist/migrate.js"))) {
  console.error("assembled server is missing @event-editor/core/dist/migrate.js - migrations would fail at launch");
  process.exit(1);
}

// 5. The Next standalone trace copies only better-sqlite3's prebuilt .node + lib,
// not its C++ sources, so @electron/rebuild cannot recompile it for Electron's
// ABI in place (it silently leaves the system-Node binary, which fails to dlopen
// under Electron). Replace it with the full source copy from the repo install so
// rebuild-native can actually rebuild it. (sharp is N-API / ABI-stable, no rebuild needed.)
const fullSqlite = resolve(repo, "node_modules/better-sqlite3");
const destSqlite = resolve(out, "node_modules/better-sqlite3");
if (!existsSync(resolve(fullSqlite, "binding.gyp"))) {
  console.error(`full better-sqlite3 source not found at ${fullSqlite} - cannot make it rebuildable for Electron`);
  process.exit(1);
}
rmSync(destSqlite, { recursive: true, force: true });
cpSync(fullSqlite, destSqlite, { recursive: true });

// 6. The forked migrate.js is core's separately-shipped dist, so it needs core's
// runtime deps as real modules. The Next server bundles drizzle-orm into its
// chunks, so output-file-tracing never emits it; without this copy migrate.js
// only resolves drizzle-orm by walking up to the repo's node_modules, which
// works from the dev location but breaks once the app is moved to /Applications.
// drizzle-orm is pure JS with no runtime deps of its own. (better-sqlite3, core's
// other dep, is handled above.)
const fullDrizzle = resolve(repo, "node_modules/drizzle-orm");
if (!existsSync(fullDrizzle)) {
  console.error(`drizzle-orm not found at ${fullDrizzle} - the forked migrate step needs it shipped`);
  process.exit(1);
}
cpSync(fullDrizzle, resolve(out, "node_modules/drizzle-orm"), { recursive: true });

console.log("assembled server ->", out);
