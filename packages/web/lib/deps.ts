import { mkdir, writeFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { binDir, managedYtDlpPath, ytDlpBin, hasYtDlp } from "./convert";
import { findSoffice } from "./pptx-convert";

export function ytDlpAsset(platform: NodeJS.Platform): string {
  if (platform === "win32") return "yt-dlp.exe";
  if (platform === "darwin") return "yt-dlp_macos";
  return "yt-dlp_linux";
}

export function ytDlpDownloadUrl(platform: NodeJS.Platform): string {
  return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpAsset(platform)}`;
}

// yt-dlp publishes one checksum manifest per release listing every asset.
export function ytDlpSumsUrl(): string {
  return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";
}

// Find the lowercased hex SHA-256 for `assetName` in a `SHA2-256SUMS` file
// (lines are "<64-hex-digits>  <filename>"). Returns null if absent/malformed.
export function parseSha256Sum(sumsText: string, assetName: string): string | null {
  for (const line of sumsText.split("\n")) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+(.+)$/);
    if (m && m[2].trim() === assetName) return m[1].toLowerCase();
  }
  return null;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const proc = spawn(bin, args);
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", rej);
    proc.on("close", (code) => (code === 0 ? res(out) : rej(new Error(err.trim() || `${bin} exited ${code}`))));
  });
}

export async function ytDlpVersion(): Promise<string | null> {
  const bin = ytDlpBin();
  if (!bin) return null;
  try { return (await run(bin, ["--version"])).trim(); } catch { return null; }
}

export async function downloadYtDlp(): Promise<{ version: string }> {
  const asset = ytDlpAsset(process.platform);
  const res = await fetch(ytDlpDownloadUrl(process.platform), { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  // Verify the download against yt-dlp's published checksum BEFORE writing an
  // executable to disk. Fail closed: any verification gap aborts the install.
  const sumsRes = await fetch(ytDlpSumsUrl(), { redirect: "follow" });
  if (!sumsRes.ok) throw new Error(`Could not fetch checksums: HTTP ${sumsRes.status}`);
  const expected = parseSha256Sum(await sumsRes.text(), asset);
  if (!expected) throw new Error(`No published checksum for ${asset}; refusing to install.`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${asset}; download rejected.`);
  }

  await mkdir(binDir(), { recursive: true });
  const dest = managedYtDlpPath();
  await writeFile(dest, bytes);
  if (process.platform !== "win32") await chmod(dest, 0o755);
  const version = await ytDlpVersion();
  if (!version) throw new Error("Downloaded yt-dlp but it did not run. Try again.");
  return { version };
}

export interface Dep {
  id: "ffmpeg" | "ytdlp" | "libreoffice";
  label: string;
  ready: boolean;
  managed: boolean;      // true if the app can fetch/manage it in-app
  version?: string;
  installUrl?: string;   // for non-managed deps: where to download
  hint?: string;         // e.g. a brew command
}

export type DepId = Dep["id"];

export async function dependencyStatuses(): Promise<Dep[]> {
  const ytVersion = await ytDlpVersion();
  return [
    {
      id: "ffmpeg",
      label: "ffmpeg",
      ready: !!ffmpegPath,
      managed: false,
      hint: "Bundled with the app.",
    },
    {
      id: "ytdlp",
      label: "yt-dlp",
      ready: hasYtDlp(),
      managed: true,
      version: ytVersion ?? undefined,
    },
    {
      id: "libreoffice",
      label: "LibreOffice",
      ready: findSoffice() !== null,
      managed: false,
      installUrl: "https://www.libreoffice.org/download/download-libreoffice/",
      hint: "On Mac: brew install --cask libreoffice",
    },
  ];
}
