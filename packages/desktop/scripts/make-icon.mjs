// Generate the Bento app icon (icns + ico + png) from icons/master.svg,
// the same designed mark as the web favicon (packages/web/app/icon.svg).
// Rasterizes with sharp, packs .icns via macOS iconutil, .ico as PNG-in-ICO.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require(path.resolve(fileURLToPath(new URL("../../web/node_modules/sharp/lib/index.js", import.meta.url))));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICONS = path.join(HERE, "..", "icons");
const MASTER = path.join(ICONS, "master.svg");
const svg = readFileSync(MASTER);

const render = (size) =>
  sharp(svg, { density: 384 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

// ---- icns via iconutil ----
const isetDir = path.join(ICONS, "icon.iconset");
rmSync(isetDir, { recursive: true, force: true });
mkdirSync(isetDir, { recursive: true });
const icnsSpec = [
  [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"],
];
for (const [size, name] of icnsSpec) writeFileSync(path.join(isetDir, name), await render(size));
execFileSync("iconutil", ["-c", "icns", isetDir, "-o", path.join(ICONS, "icon.icns")]);

// ---- ico (PNG-in-ICO, Vista+) ----
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(icoSizes.map(render));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
const dir = Buffer.alloc(16 * icoSizes.length);
let offset = 6 + dir.length;
pngs.forEach((png, i) => {
  const s = icoSizes[i];
  const e = dir.subarray(i * 16);
  e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
  offset += png.length;
});
writeFileSync(path.join(ICONS, "icon.ico"), Buffer.concat([header, dir, ...pngs]));

// ---- flat png (electron-builder linux / fallback) ----
writeFileSync(path.join(ICONS, "icon.png"), await render(1024));

rmSync(isetDir, { recursive: true, force: true });
console.log("wrote icon.icns, icon.ico, icon.png from master.svg");
