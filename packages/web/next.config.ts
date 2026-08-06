import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { assertAuthConfig } from "./lib/auth";

// Next loads .env from its own cwd (packages/web); the real keys live in the
// repo-root .env. Load that here so dev/build/start see them regardless of cwd.
// Next runs its own loadEnvConfig for packages/web (no .env there) BEFORE
// evaluating this config, and @next/env memoizes the result at module scope —
// so a plain call here early-returns from that empty cache and loads nothing.
// forceReload (4th arg) bypasses the cache and actually reads the root .env.
const here = dirname(fileURLToPath(import.meta.url));
loadEnvConfig(resolve(here, "../.."), process.env.NODE_ENV !== "production", undefined, true);

// Fail closed at boot rather than silently running unauthenticated —
// see final-review.md Important #1.
assertAuthConfig(process.env);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: resolve(here, "../.."),
  // pdfjs-dist must stay external: bundled, its "fake worker" fallback tries to
  // import pdf.worker.mjs next to the rewritten chunk, which the build never
  // emits, so every server-side PDF raster (convert PDF->png/jpg/html) 500s with
  // "Setting up fake worker failed". Required at runtime it resolves normally.
  serverExternalPackages: ["better-sqlite3", "sharp", "@anthropic-ai/sdk", "ffmpeg-static", "ffprobe-static", "@napi-rs/canvas", "pdfjs-dist"],
  // Under Node there is no Worker global, so pdfjs loads its worker through the
  // "fake worker" path: a dynamic import of pdf.worker.mjs sitting next to
  // pdf.mjs. That import is invisible to the file tracer, so the worker never
  // reaches .next/standalone and PDF rasterising 500s. Ship it explicitly.
  outputFileTracingIncludes: {
    "/api/convert/file": [
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
    "/api/pdf/process/[mode]": [
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
};

export default nextConfig;
