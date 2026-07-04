import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jobDir, sanitizeJobId } from "@/lib/jobs";
import { safeBase } from "@event-editor/core/names";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const fmt = url.searchParams.get("format") === "png" ? "png" : "jpg";
  const name = `${safeBase(url.searchParams.get("name") || "image") || "image"}`;
  try {
    const bytes = await readFile(resolve(jobDir("heic", sanitizeJobId(id)), `out.${fmt}`));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": fmt === "png" ? "image/png" : "image/jpeg",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
