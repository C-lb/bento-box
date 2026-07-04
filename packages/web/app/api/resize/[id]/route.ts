import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jobDir, sanitizeJobId } from "@/lib/jobs";
import { safeBase } from "@event-editor/core/names";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const rawExt = url.searchParams.get("ext");
  const ext = rawExt === "png" || rawExt === "webp" ? rawExt : "jpg";
  const name = `${safeBase(url.searchParams.get("name") || "image") || "image"}`;
  try {
    const bytes = await readFile(resolve(jobDir("resize", sanitizeJobId(id)), `out.${ext}`));
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
