import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Next loads .env from its own cwd (packages/web); the real keys live in the
// repo-root .env. Load that here so dev/build/start see them regardless of cwd.
const here = dirname(fileURLToPath(import.meta.url));
loadEnvConfig(resolve(here, "../.."));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: resolve(here, "../.."),
  serverExternalPackages: ["better-sqlite3", "sharp", "@anthropic-ai/sdk", "ffmpeg-static", "ffprobe-static"],
};

export default nextConfig;
