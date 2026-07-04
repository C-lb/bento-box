import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jobDir, sanitizeJobId } from "@/lib/jobs";
import { safeBase } from "@event-editor/core/names";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const name = `${safeBase(url.searchParams.get("name") || "video") || "video"}`;
  try {
    const bytes = await readFile(resolve(jobDir("video", sanitizeJobId(id)), "out.mp4"));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
