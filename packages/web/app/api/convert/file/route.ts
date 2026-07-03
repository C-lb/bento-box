import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newConvertId, convertDir, transcodeToMp3, cleanupConvert, sweepOldConverts } from "@/lib/convert";
import { sanitizeMp3Filename, defaultNameFromSource } from "@event-editor/core/convert";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const rawName = form.get("filename");
  const nameField = typeof rawName === "string" ? rawName.trim() : undefined;
  const name = sanitizeMp3Filename(nameField || defaultNameFromSource(file.name) || "audio");

  const id = newConvertId();
  const dir = convertDir(id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldConverts(6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  const inPath = resolve(dir, "source");
  try {
    await writeFile(inPath, Buffer.from(await file.arrayBuffer()));
    await transcodeToMp3(inPath, id);
    return NextResponse.json({ id, filename: name });
  } catch (err) {
    try { await cleanupConvert(id); } catch { /* best-effort */ }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
