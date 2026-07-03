import { readFile } from "node:fs/promises";
import { mp3Path, sanitizeConvertId } from "@/lib/convert";
import { sanitizeMp3Filename } from "@event-editor/core/convert";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clean = sanitizeConvertId(id);
  const url = new URL(request.url);
  const name = sanitizeMp3Filename(url.searchParams.get("name") || "audio");
  try {
    const bytes = await readFile(mp3Path(clean));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
