// Replace anything unsafe for a filename with an underscore, collapse runs,
// and trim leading/trailing separators. Callers strip the extension first.
function safeBase(raw: string): string {
  return raw
    .replace(/[\/\\]/g, "_")            // path separators
    .replace(/[^a-zA-Z0-9._-]+/g, "_")  // any other unsafe char -> _
    .replace(/_+/g, "_")                 // collapse runs
    .replace(/^[-_.]+|[-_.]+$/g, "")     // trim leading/trailing -, _ or .
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

// Resolve a text query to the single best YouTube match without downloading.
// ytsearch1: lets yt-dlp run the search; id and title come back tab-separated
// so the caller can then download that exact video by id.
export function ytDlpSearchArgs(query: string): string[] {
  return ["--no-playlist", "--print", "%(id)s\t%(title)s", `ytsearch1:${query}`];
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

// ffmpeg argv to extract/transcode an input's audio into the given format.
// mp3 mirrors ffmpegMp3Args; wav is lossless PCM; m4a is AAC.
export function audioArgs(
  inPath: string, outPath: string, format: "mp3" | "wav" | "m4a",
): string[] {
  const base = ["-y", "-i", inPath, "-vn"];
  if (format === "wav") return [...base, "-c:a", "pcm_s16le", outPath];
  if (format === "m4a") return [...base, "-c:a", "aac", "-b:a", "192k", outPath];
  return [...base, "-c:a", "libmp3lame", "-b:a", "192k", outPath];
}
