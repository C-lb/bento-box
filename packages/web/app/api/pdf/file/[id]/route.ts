import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jobDir, sanitizeJobId } from "@/lib/jobs";
import { safeBase } from "@event-editor/core/names";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "zip" ? "zip" : "pdf";
  const rawName = url.searchParams.get("name") || (kind === "zip" ? "split.zip" : "document.pdf");
  const ext = rawName.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? `.${kind}`;
  const name = `${safeBase(rawName.replace(/\.[a-z0-9]{1,5}$/i, "")) || "file"}${ext}`;
  try {
    const bytes = await readFile(resolve(jobDir("pdf", sanitizeJobId(id)), `out.${kind}`));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": kind === "zip" ? "application/zip" : "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
