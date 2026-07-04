// Self-host MediaPipe's WASM runtime + selfie segmenter model under public/ so the
// browser loads them from our own origin (offline, private) instead of a Google CDN.
// Runs on predev/prebuild. Dest is git-ignored (a copy/download of a dependency).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const destDir = resolve(here, "..", "public", "mediapipe");
const wasmDest = resolve(destDir, "wasm");
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const modelDest = resolve(destDir, "selfie_segmenter.tflite");

// 1. Copy the WASM runtime from the installed package.
// Note: the package's "exports" map does not expose "./package.json", so
// require.resolve(".../package.json") throws ERR_PACKAGE_PATH_NOT_EXPORTED under
// Node's ESM exports enforcement. Resolve via an exported wasm subpath instead.
const wasmEntry = require.resolve("@mediapipe/tasks-vision/vision_wasm_internal.js");
const wasmSrc = dirname(wasmEntry);
if (!existsSync(wasmSrc)) {
  console.error(`[mediapipe-assets] wasm source not found: ${wasmSrc}`);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
rmSync(wasmDest, { recursive: true, force: true });
cpSync(wasmSrc, wasmDest, { recursive: true });
console.log(`[mediapipe-assets] copied wasm -> ${wasmDest}`);

// 2. Download the model once (skip if already present).
if (existsSync(modelDest)) {
  console.log(`[mediapipe-assets] model already present, skipping download`);
} else {
  const res = await fetch(modelUrl);
  if (!res.ok) {
    console.error(`[mediapipe-assets] model download failed: ${res.status} ${modelUrl}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(modelDest, buf);
  console.log(`[mediapipe-assets] downloaded model (${buf.length} bytes) -> ${modelDest}`);
}
