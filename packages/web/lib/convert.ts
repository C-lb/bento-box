import { resolve, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { rm, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { ytDlpTitleArgs, ytDlpSearchArgs, ytDlpExtractArgs, ffmpegMp3Args, audioArgs } from "@event-editor/core/convert";

const COMMON = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

export function dataRoot(): string {
  return process.env.EE_DATA_DIR ?? "data";
}
export function binDir(): string {
  return process.env.EE_BIN_DIR ?? resolve(dataRoot(), "bin");
}
export function managedYtDlpPath(platform: NodeJS.Platform = process.platform): string {
  return join(binDir(), platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}

// All candidates are real on-disk paths; link mode requires a resolvable binary,
// so there is no optimistic bare-name fallback.
export function ytDlpCandidates(env: Partial<NodeJS.ProcessEnv>, platform: NodeJS.Platform): string[] {
  const exe = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const managed = env.EE_BIN_DIR
    ? join(env.EE_BIN_DIR, exe)
    : join(env.EE_DATA_DIR ?? "data", "bin", exe);
  const out: string[] = [];
  if (env.EE_YTDLP_PATH) out.push(env.EE_YTDLP_PATH);
  out.push(managed);
  for (const dir of COMMON) out.push(`${dir}/${exe}`);
  return out;
}

export function resolveExisting(candidates: string[], exists: (p: string) => boolean): string | null {
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

export function ytDlpBin(): string | null {
  return resolveExisting(ytDlpCandidates(process.env, process.platform), existsSync);
}
export function hasYtDlp(): boolean {
  return ytDlpBin() !== null;
}
export function ffmpegDir(): string {
  if (!ffmpegPath) throw new Error("bundled ffmpeg not found");
  return dirname(ffmpegPath);
}

export function sanitizeConvertId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}
export function newConvertId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}
export function convertDir(id: string): string {
  return resolve(dataRoot(), "convert", sanitizeConvertId(id));
}
export function mp3Path(id: string): string {
  return audioOutPath(id, "mp3");
}
export function audioOutPath(id: string, format: "mp3" | "wav" | "m4a" = "mp3"): string {
  return resolve(convertDir(id), `out.${format}`);
}
export async function cleanupConvert(id: string): Promise<void> {
  await rm(convertDir(id), { recursive: true, force: true });
}
export async function sweepOldConverts(maxAgeMs: number): Promise<void> {
  const root = resolve(dataRoot(), "convert");
  let entries: string[];
  try { entries = await readdir(root); } catch { return; }
  const now = Date.now();
  for (const name of entries) {
    const p = resolve(root, name);
    try {
      const s = await stat(p);
      if (s.isDirectory() && now - s.mtimeMs > maxAgeMs) await rm(p, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
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

export async function fetchTitle(url: string): Promise<string> {
  const bin = ytDlpBin();
  if (!bin) throw new Error("yt-dlp is not installed");
  const out = await run(bin, ytDlpTitleArgs(url));
  return out.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

// Resolve a search query to the top YouTube match (id + title) without
// downloading, so the caller can report the match and then fetch it by id.
export async function searchYouTube(query: string): Promise<{ id: string; title: string }> {
  const bin = ytDlpBin();
  if (!bin) throw new Error("yt-dlp is not installed");
  const out = await run(bin, ytDlpSearchArgs(query));
  const line = out.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const tab = line.indexOf("\t");
  const vid = tab >= 0 ? line.slice(0, tab) : line;
  const title = tab >= 0 ? line.slice(tab + 1) : "";
  if (!vid) throw new Error("No YouTube match was found for that track");
  return { id: vid, title: title || vid };
}

export async function extractFromUrl(
  url: string, id: string, format: "mp3" | "wav" | "m4a" = "mp3",
): Promise<void> {
  const bin = ytDlpBin();
  if (!bin) throw new Error("yt-dlp is not installed");
  // yt-dlp writes <stem>.<format>; stem is the output path without the extension.
  const stem = audioOutPath(id, format).replace(new RegExp(`\\.${format}$`), "");
  await run(bin, ytDlpExtractArgs(url, stem, ffmpegDir(), format));
}

export async function transcodeToMp3(inPath: string, id: string): Promise<void> {
  if (!ffmpegPath) throw new Error("bundled ffmpeg not found");
  await run(ffmpegPath, ffmpegMp3Args(inPath, mp3Path(id)));
}

export async function transcodeAudio(
  inPath: string, id: string, format: "mp3" | "wav" | "m4a",
): Promise<void> {
  if (!ffmpegPath) throw new Error("bundled ffmpeg not found");
  const outPath = resolve(convertDir(id), `out.${format}`);
  await run(ffmpegPath, audioArgs(inPath, outPath, format));
}
