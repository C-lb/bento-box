import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { convertDir, sanitizeConvertId } from "@/lib/convert";
import { swapExt } from "@event-editor/core/names";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  zip: "application/zip",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  html: "text/html",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clean = sanitizeConvertId(id);
  const url = new URL(request.url);
  const rawExt = url.searchParams.get("ext");
  const ext = (rawExt && Object.hasOwn(CONTENT_TYPES, rawExt)) ? rawExt : "mp3";
  const name = swapExt(url.searchParams.get("name") || "audio", ext);
  try {
    const bytes = await readFile(resolve(convertDir(clean), `out.${ext}`));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": CONTENT_TYPES[ext],
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
