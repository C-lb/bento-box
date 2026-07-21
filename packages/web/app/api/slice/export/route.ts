import { NextResponse } from "next/server";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { masterPdfPath, outDir } from "@/lib/slice";
import { buildOutputs, pdfPageCount } from "@/lib/pdf-slice";
import { planSlices, type GroupInput } from "@event-editor/core/slice-plan";
import { getDb } from "@/lib/db";
import { markSliceRunSliced } from "@event-editor/core/slice-runs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { runId, groups, confidential, watermarkText, format, rotationDeg, sizeScale, opacity } = (await request.json()) as {
      runId: string;
      groups: GroupInput[];
      confidential: boolean;
      watermarkText?: string;
      format?: "pdf" | "html";
      rotationDeg?: number;
      sizeScale?: number;
      opacity?: number;
    };
    if (!runId || !Array.isArray(groups)) {
      return NextResponse.json({ error: "runId and groups required" }, { status: 400 });
    }

    const master = await readFile(masterPdfPath(runId));
    const pageCount = await pdfPageCount(master);
    const plan = planSlices(groups, pageCount);
    if (plan.groups.length === 0) {
      return NextResponse.json({ error: "No exportable portions.", warnings: plan.warnings }, { status: 400 });
    }

    const dir = outDir(runId);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const outputs = await buildOutputs(master, plan.groups, {
      confidential: !!confidential,
      watermarkText: watermarkText ?? "CONFIDENTIAL",
      format: format === "html" ? "html" : "pdf",
      rotationDeg, sizeScale, opacity,
    });
    for (const o of outputs) await writeFile(join(dir, o.filename), Buffer.from(o.bytes));
    // Best-effort history: the outputs are already on disk, so a slice_runs
    // write failure must not turn a successful export into a 500.
    try { markSliceRunSliced(getDb(), runId); } catch { /* history is non-critical */ }

    return NextResponse.json({
      files: outputs.map((o) => ({ label: o.label, filename: o.filename })),
      warnings: plan.warnings,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
