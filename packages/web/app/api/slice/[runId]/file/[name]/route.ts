import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { outDir } from "@/lib/slice";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string; name: string }> }) {
  const { runId, name } = await ctx.params;
  const safe = basename(name); // block path traversal
  try {
    const bytes = await readFile(join(outDir(runId), safe));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${safe}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
