import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { masterPdfPath } from "@/lib/slice";
import { pdfPageCount, extractPages, watermarkPdf, clampStampOpts } from "@/lib/pdf-slice";
import { renderPdfPages } from "@/lib/convert-file";

export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const url = new URL(request.url);
  const pageParam = url.searchParams.get("page");
  const page = pageParam ? Number(pageParam) : NaN;
  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: "page must be a positive integer" }, { status: 400 });
  }

  let master: Buffer;
  try {
    master = await readFile(masterPdfPath(runId));
  } catch {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const pageCount = await pdfPageCount(master);
  if (page > pageCount) {
    return NextResponse.json({ error: `page must be between 1 and ${pageCount}` }, { status: 400 });
  }

  const text = url.searchParams.get("text") ?? "CONFIDENTIAL";
  const opts = clampStampOpts({
    rotationDeg: numOrUndefined(url.searchParams.get("rotationDeg")),
    sizeScale: numOrUndefined(url.searchParams.get("sizeScale")),
    opacity: numOrUndefined(url.searchParams.get("opacity")),
  });

  const single = await extractPages(master, [page]);
  const stamped = await watermarkPdf(single, text, opts);
  const [png] = await renderPdfPages(Buffer.from(stamped));

  return new NextResponse(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}

function numOrUndefined(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
