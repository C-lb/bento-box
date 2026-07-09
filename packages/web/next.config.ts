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
  serverExternalPackages: ["better-sqlite3", "sharp", "@anthropic-ai/sdk", "ffmpeg-static", "ffprobe-static", "@napi-rs/canvas"],
};

export default nextConfig;
