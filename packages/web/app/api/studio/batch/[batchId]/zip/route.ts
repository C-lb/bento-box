import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import { createReadStream, existsSync } from "node:fs";
import archiver from "archiver";
import { headshots } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const rows = getDb().select().from(headshots).where(eq(headshots.batchId, batchId)).all()
    .filter((r) => r.status === "done" && r.outputPath);

  const archive = archiver("zip", { zlib: { level: 9 } });
  const used = new Set<string>();
  for (const r of rows) {
    const abs = resolve(r.outputPath!);
    if (!existsSync(abs)) continue;
    const base = (r.nameText?.trim() || `headshot-${r.id}`).replace(/[^\w .-]+/g, "_");
    let fname = `${base}.png`;
    let n = 1;
    while (used.has(fname)) fname = `${base} (${n++}).png`;
    used.add(fname);
    archive.append(createReadStream(abs), { name: fname });
  }

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
      "Content-Disposition": `attachment; filename="headshots-${batchId}.zip"`,
    },
  });
}
