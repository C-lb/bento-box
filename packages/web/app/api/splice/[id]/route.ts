import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jobDir, sanitizeJobId } from "@/lib/jobs";
import { safeBase } from "@event-editor/core/names";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const isAudio = url.searchParams.get("kind") === "audio";
  const file = isAudio ? "out.m4a" : "out.mp4";
  const contentType = isAudio ? "audio/mp4" : "video/mp4";
  const name = `${safeBase(url.searchParams.get("name") || "joined") || "joined"}`;
  try {
    const bytes = await readFile(resolve(jobDir("splice", sanitizeJobId(id)), file));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
