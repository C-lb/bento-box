// Replace anything unsafe for a filename with an underscore, collapse runs,
// and trim leading/trailing separators. Callers strip the extension first.
function safeBase(raw: string): string {
  return raw
    .replace(/[\/\\]/g, "_")            // path separators
    .replace(/[^a-zA-Z0-9._-]+/g, "_")  // any other unsafe char -> _
    .replace(/_+/g, "_")                 // collapse runs
    .replace(/^[_.]+|[_.]+$/g, "")       // trim leading/trailing _ or .
    .slice(0, 120);
}

export function sanitizeMp3Filename(raw: string): string {
  // Drop a trailing .mp3 (case-insensitive) before sanitizing, re-add one after.
  const withoutExt = raw.replace(/\.mp3$/i, "");
  const base = safeBase(withoutExt);
  return `${base || "audio"}.mp3`;
}

export function defaultNameFromSource(name: string): string {
  const withoutExt = name.replace(/\.[a-z0-9]{1,5}$/i, "");
  const base = safeBase(withoutExt);
  return base || "audio";
}

export function ytDlpTitleArgs(url: string): string[] {
  return ["--no-playlist", "--print", "title", url];
}

export function ytDlpExtractArgs(url: string, outStem: string, ffmpegLocation: string): string[] {
  return [
    "--no-playlist", "-x", "--audio-format", "mp3", "--audio-quality", "192K",
    "--ffmpeg-location", ffmpegLocation,
    "-o", `${outStem}.%(ext)s`, url,
  ];
}

export function ffmpegMp3Args(inPath: string, outPath: string): string[] {
  return ["-y", "-i", inPath, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", outPath];
}
