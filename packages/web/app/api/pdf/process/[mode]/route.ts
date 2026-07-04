import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newJobId, jobDir, cleanupJob, sweepOldJobs } from "@/lib/jobs";
import { parsePageRanges, pdfOutName } from "@event-editor/core/pdf";
import { mergePdfs, splitPdf, resavePdf, zipFiles, pageCount } from "@/lib/pdf";

export const runtime = "nodejs";

async function filesToBuffers(files: File[]): Promise<Buffer[]> {
  return Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
}

export async function POST(request: Request, { params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Add at least one PDF" }, { status: 400 });

  const id = newJobId();
  const dir = jobDir("pdf", id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldJobs("pdf", 6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  try {
    const bufs = await filesToBuffers(files);
    const base = (files[0].name || "document").replace(/\.pdf$/i, "");

    if (mode === "merge") {
      const out = await mergePdfs(bufs);
      await writeFile(resolve(dir, "out.pdf"), out);
      return NextResponse.json({ id, filename: pdfOutName(base, "-merged.pdf"), kind: "pdf" });
    }
    if (mode === "compress") {
      const out = await resavePdf(bufs[0]);
      await writeFile(resolve(dir, "out.pdf"), out);
      return NextResponse.json({ id, filename: pdfOutName(base, "-tidied.pdf"), kind: "pdf" });
    }
    if (mode === "split") {
      const spec = String(form.get("ranges") ?? "");
      const single = String(form.get("single") ?? "") === "true";
      const count = await pageCount(bufs[0]);
      const ranges = parsePageRanges(spec, count); // throws readable errors
      const parts = await splitPdf(bufs[0], ranges, { single });
      if (single) {
        await writeFile(resolve(dir, "out.pdf"), parts[0].data);
        return NextResponse.json({ id, filename: pdfOutName(base, "-selected.pdf"), kind: "pdf" });
      }
      const zip = await zipFiles(parts);
      await writeFile(resolve(dir, "out.zip"), zip);
      return NextResponse.json({ id, filename: pdfOutName(base, "-split.zip"), kind: "zip" });
    }
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (err) {
    try { await cleanupJob("pdf", id); } catch { /* best-effort */ }
    // Page-range errors are user-facing 400s; everything else is a 500.
    const msg = err instanceof Error ? err.message : String(err);
    const status = /page|range|out of range/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
