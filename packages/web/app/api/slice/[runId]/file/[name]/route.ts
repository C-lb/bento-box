import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { outDir } from "@/lib/slice";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".html": "text/html",
};

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string; name: string }> }) {
  const { runId, name } = await ctx.params;
  const safe = basename(name); // block path traversal
  try {
    const bytes = await readFile(join(outDir(runId), safe));
    const contentType = CONTENT_TYPES[extname(safe).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${safe.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
