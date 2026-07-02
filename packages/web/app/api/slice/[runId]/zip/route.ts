import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import { outDir, sanitizeRunId } from "@/lib/slice";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const dir = outDir(runId);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".pdf"));
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (names.length === 0) return NextResponse.json({ error: "nothing to zip" }, { status: 404 });

  const archive = archiver("zip", { zlib: { level: 9 } });
  for (const n of names) archive.append(createReadStream(join(dir, n)), { name: n });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      archive.on("data", (chunk) => controller.enqueue(chunk));
      archive.on("end", () => controller.close());
      archive.on("error", (err) => controller.error(err));
    },
  });
  archive.finalize();

  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="slices-${sanitizeRunId(runId)}.zip"`,
    },
  });
}
