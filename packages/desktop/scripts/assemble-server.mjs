// packages/desktop/scripts/assemble-server.mjs
// Assembles a self-contained, runnable Next server tree into build/server.
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync } from "node:fs";
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
// 1b. Turbopack externalises some packages under hashed aliases in
// .next/node_modules (e.g. "@anthropic-ai/sdk-8a97726827ff28fc") that are
// SYMLINKS back into the build machine's tree. ESM `import()` resolves through
// these links directly (the require() shim in step 7 never sees it), and on CI
// Next writes them as ABSOLUTE paths into the runner's checkout, so the shipped
// link dangles on every other machine and any route importing the package dies
// with a bare 500 (bit v0.0.14: transcribe + photo sorter). Replace every such
// symlink with a real copy of the package so nothing downstream (electron-builder,
// dmg, Windows) can mangle a link again.
const nextNm = resolve(out, "packages/web/.next/node_modules");
if (existsSync(nextNm)) {
  const entries = [];
  for (const name of readdirSync(nextNm)) {
    const p = resolve(nextNm, name);
    if (name.startsWith("@")) for (const sub of readdirSync(p)) entries.push(resolve(p, sub));
    else entries.push(p);
  }
  for (const link of entries) {
    if (!lstatSync(link).isSymbolicLink()) continue;
    const target = readlinkSync(link);
    const m = /node_modules[\\/](.+?)[\\/]?$/.exec(target);
    if (!m) {
      console.error(`unrecognised symlink under .next/node_modules: ${link} -> ${target}`);
      process.exit(1);
    }
    const realPkg = m[1].split(/[\\/]/).slice(0, m[1].startsWith("@") ? 2 : 1).join("/");
    const realDir = resolve(out, "node_modules", realPkg);
    if (!existsSync(realDir)) {
      console.error(`.next/node_modules alias ${link} points at ${realPkg}, which is not in the bundle's node_modules`);
      process.exit(1);
    }
    rmSync(link);
    cpSync(realDir, link, { recursive: true, dereference: true });
    console.log(`dereferenced .next alias -> ${realPkg}`);
  }
}

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

// 5b. sharp loads its native binary from a platform-specific package
// (@img/sharp-<platform>) via a require whose specifier is built at runtime from
// process.platform/arch. Next's output-file-tracing can't follow that dynamic
// specifier, so the standalone trace ships sharp's JS but omits the @img platform
// package - on macOS the host's darwin @img happens to get traced, but on Windows
// the win32 binary is absent and sharp fails to dlopen (ERR_DLOPEN_FAILED).
// Ship sharp + every installed @img/* package from the repo install explicitly;
// npm ci installs the build host's own platform binaries, so each runner's build
// gets the right ones. sharp is N-API / ABI-stable, so the prebuilt .node loads
// under Electron with no rebuild needed.
const fullSharp = resolve(repo, "node_modules/sharp");
if (!existsSync(fullSharp)) {
  console.error(`sharp not found at ${fullSharp} - the web server needs it shipped`);
  process.exit(1);
}
cpSync(fullSharp, resolve(out, "node_modules/sharp"), { recursive: true });
const imgDir = resolve(repo, "node_modules/@img");
if (!existsSync(imgDir)) {
  console.error(`@img platform packages not found at ${imgDir} - sharp's native binary would be missing`);
  process.exit(1);
}
cpSync(imgDir, resolve(out, "node_modules/@img"), { recursive: true });

// 5c. @napi-rs/canvas is prebuilt N-API (ABI-stable, like sharp) but also ships
// its native binary via a platform-specific package (@napi-rs/canvas-<platform>)
// resolved at runtime, so it needs the same explicit-copy treatment as sharp/@img.
// The PDF->image converter (Task 5) uses this for rasterizing pdfjs-dist pages.
function napiCanvasPlatformPkgs() {
  const scope = resolve(repo, "node_modules/@napi-rs");
  if (!existsSync(scope)) return [];
  return readdirSync(scope)
    .filter((n) => n.startsWith("canvas-"))
    .map((n) => `@napi-rs/${n}`);
}
for (const pkg of ["@napi-rs/canvas", ...napiCanvasPlatformPkgs()]) {
  const from = resolve(repo, "node_modules", pkg);
  if (existsSync(from)) {
    cpSync(from, resolve(out, "node_modules", pkg), { recursive: true });
  }
}

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

// 7. Make the standalone relocatable for the externalized native packages.
// Next records the build-time absolute location of serverExternalPackages
// (better-sqlite3, sharp, ...) and at runtime loads them (and their .node
// binaries) from that absolute path, which points back at the build machine's
// repo once the app is moved. On the build machine that repo copy is the
// system-Node ABI, so db/image-backed pages 500. Standard Node resolution from
// the bundle already finds the bundle's own Electron-ABI copies, so inject a
// module-load shim at the top of server.js that redirects any external-package
// request (bare specifier OR an absolute `.../node_modules/<pkg>/<subpath>`,
// including the raw .node file bindings asks for) to the bundle's own copy,
// preserving the subpath. server.js already imports `path` and `module` and
// defines `__dirname` (= <bundle>/packages/web) before this point.
const serverJs = resolve(out, "packages/web/server.js");
let serverSrc = readFileSync(serverJs, "utf8");
const anchor = "const __dirname = fileURLToPath(new URL('.', import.meta.url))";
if (!serverSrc.includes(anchor)) {
  console.error("could not find the __dirname anchor in server.js to inject the external-resolution shim - Next standalone format changed");
  process.exit(1);
}
const externals = JSON.stringify(["better-sqlite3", "sharp", "@anthropic-ai/sdk", "ffmpeg-static", "ffprobe-static", "@napi-rs/canvas"]);
const shim = `
// --- event-editor: force externalized native packages to the bundle's own copies ---
const __EE_EXTERNALS__ = ${externals};
const __ee_origLoad = module._load;
const __ee_bundleRoot = path.join(__dirname, '..', '..');
function __ee_pkgOf(after){ const p = after.split('/'); return p[0].startsWith('@') ? p.slice(0, 2).join('/') : p[0]; }
// Turbopack (Next 16) externalises native packages under a hashed alias, e.g.
// "better-sqlite3-90e2652d1716b047". Match the real package by exact name OR by a
// "<pkg>-<hash>" prefix, then redirect to the bundle's own (Electron-ABI) copy.
function __ee_realOf(name){
  for (const e of __EE_EXTERNALS__) { if (name === e || name.startsWith(e + '-')) return e; }
  return null;
}
module._load = function (request, parent, isMain) {
  if (typeof request === 'string') {
    const i = request.lastIndexOf('/node_modules/');
    if (i !== -1) {
      const after = request.slice(i + 14);
      const pkg = __ee_pkgOf(after);
      const real = __ee_realOf(pkg);
      if (real) return __ee_origLoad.call(this, path.join(__ee_bundleRoot, 'node_modules', real + after.slice(pkg.length)), parent, isMain);
    } else {
      const real = __ee_realOf(request);
      if (real) return __ee_origLoad.call(this, path.join(__ee_bundleRoot, 'node_modules', real), parent, isMain);
    }
  }
  return __ee_origLoad.apply(this, arguments);
};
// --- end event-editor shim ---`;
serverSrc = serverSrc.replace(anchor, anchor + "\n" + shim);
writeFileSync(serverJs, serverSrc);

// 8. Preset keys for the settings setup code. The packaged app has no repo .env
// two levels above cwd (the dev fallback in settings/preset.ts), so without this
// the code is a no-op in installed builds. Bake the preset keys from the build
// machine's repo .env (or the process env, so CI can supply them as secrets)
// into build/preset.env; electron-builder ships it in Resources and main.js
// points EE_PRESET_ENV at it. Always written, even empty, so the settings action
// can say "no preset keys in this build" instead of failing on a missing file.
const PRESET_BAKE_KEYS = [
  "EE_UNLOCK_CODE",
  "GROQ_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];
const rootEnvPath = resolve(repo, ".env");
const rootEnvLines = existsSync(rootEnvPath) ? readFileSync(rootEnvPath, "utf8").split(/\r?\n/) : [];
let presetBody = "# preset keys for the settings setup code, baked at package time\n";
let presetCount = 0;
for (const key of PRESET_BAKE_KEYS) {
  const fromFile = rootEnvLines.find((l) => l.startsWith(`${key}=`));
  const value = fromFile ? fromFile.slice(key.length + 1).trim() : (process.env[key] ?? "").trim();
  if (value) {
    presetBody += `${key}=${value}\n`;
    presetCount++;
  }
}
writeFileSync(resolve(here, "../build/preset.env"), presetBody);
console.log(`preset.env baked with ${presetCount} key(s)`);

console.log("assembled server ->", out);
