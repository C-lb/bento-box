import { NextResponse } from "next/server";
import { mkdir } from "node:fs/promises";
import { hasYtDlp, newConvertId, convertDir, extractFromUrl, searchYouTube, cleanupConvert, sweepOldConverts } from "@/lib/convert";
import { sanitizeAudioFilename } from "@event-editor/core/convert";
import { isSpotifyTrackUrl, resolveSpotifyTrack, spotifyConfigured } from "@/lib/spotify";
import { createToolRun } from "@event-editor/core/tool-runs";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const AUDIO_FORMATS = new Set(["mp3", "wav", "m4a"]);
type AudioFormat = "mp3" | "wav" | "m4a";

// Streams newline-delimited JSON stage events so the UI can narrate what's
// happening (matching a Spotify track on YouTube, downloading, transcoding).
// Pre-flight failures return a normal JSON error before the stream opens.
export async function POST(request: Request) {
  if (!hasYtDlp()) {
    return NextResponse.json({ error: "yt-dlp is not installed. See the tool page for install steps." }, { status: 400 });
  }
  const { url, filename, output } = (await request.json()) as { url?: string; filename?: string; output?: string };
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 });
  }
  if (isSpotifyTrackUrl(url) && !spotifyConfigured()) {
    return NextResponse.json({ error: "Spotify links need SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET set." }, { status: 400 });
  }
  const format: AudioFormat = output && AUDIO_FORMATS.has(output) ? (output as AudioFormat) : "mp3";
  const name = sanitizeAudioFilename(filename && filename.trim() ? filename : "audio", format);

  const id = newConvertId();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        await mkdir(convertDir(id), { recursive: true });
        try { await sweepOldConverts(6 * 60 * 60 * 1000); } catch { /* best-effort */ }

        let target = url;
        if (isSpotifyTrackUrl(url)) {
          send({ type: "status", message: "Reading the Spotify link" });
          const track = await resolveSpotifyTrack(url);
          send({ type: "status", message: `Found "${track.title}" by ${track.artist}` });
          send({ type: "status", message: "Matching the song on YouTube" });
          const match = await searchYouTube(track.query);
          send({ type: "status", message: `Matched: ${match.title}` });
          target = `https://www.youtube.com/watch?v=${match.id}`;
        } else {
          send({ type: "status", message: "Fetching the audio" });
        }

        send({ type: "status", message: `Downloading and converting to ${format}` });
        await extractFromUrl(target, id, format);
        // Best-effort "See past audio" history write; must never fail the conversion.
        try {
          createToolRun(getDb(), { tool: "audio", label: url, mode: "url", outputs: [{ id, filename: name }] });
        } catch { /* history is non-critical */ }
        send({ type: "done", id, filename: name, ext: format });
      } catch (err) {
        try { await cleanupConvert(id); } catch { /* best-effort */ }
        send({ type: "error", error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
