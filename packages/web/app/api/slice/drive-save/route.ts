import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { outDir } from "@/lib/slice";
import { getDb } from "@/lib/db";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { runId, folderId } = (await request.json()) as { runId: string; folderId: string };
    if (!runId || !folderId) return NextResponse.json({ error: "runId and folderId required" }, { status: 400 });

    const drive = await authedDriveClient(getDb());
    if (!drive) return NextResponse.json({ error: "Google is not connected. Re-auth on settings." }, { status: 400 });
    const client = makeDriveClient(drive);

    const dir = outDir(runId);
    const names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".pdf"));
    if (names.length === 0) return NextResponse.json({ error: "nothing to save" }, { status: 404 });

    const uploaded: { filename: string; url: string }[] = [];
    for (const n of names) {
      const bytes = await readFile(join(dir, n));
      const res = await client.uploadPdf(n, new Uint8Array(bytes), folderId);
      uploaded.push({ filename: n, url: res.url });
    }
    return NextResponse.json({ uploaded });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
