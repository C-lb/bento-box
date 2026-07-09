import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { newConvertId, convertDir, transcodeToMp3, cleanupConvert, sweepOldConverts } from "@/lib/convert";
import { convertUploaded } from "@/lib/convert-file";
import { sanitizeMp3Filename, defaultNameFromSource } from "@event-editor/core/convert";
import { isValidConversion, convertOutName, type OutputFormat } from "@event-editor/core/convert-formats";

export const runtime = "nodejs";

const OUTPUTS = ["png", "jpg", "webp", "pdf", "mp3", "wav", "m4a"];

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const rawOut = form.get("output");
  const output = (typeof rawOut === "string" && OUTPUTS.includes(rawOut) ? rawOut : "mp3") as OutputFormat;

  if (!isValidConversion(file.name, output)) {
    return NextResponse.json({ error: `Can't convert this file to ${output}.` }, { status: 400 });
  }

  const id = newConvertId();
  const dir = convertDir(id);
  await mkdir(dir, { recursive: true });
  try { await sweepOldConverts(6 * 60 * 60 * 1000); } catch { /* best-effort */ }
  const inPath = resolve(dir, "source");
  try {
    await writeFile(inPath, Buffer.from(await file.arrayBuffer()));

    // Backward-compatible audio path: mp3 with the existing name sanitizer.
    if (output === "mp3") {
      const rawName = form.get("filename");
      const nameField = typeof rawName === "string" ? rawName.trim() : undefined;
      const name = sanitizeMp3Filename(nameField || defaultNameFromSource(file.name) || "audio");
      await transcodeToMp3(inPath, id);
      return NextResponse.json({ id, filename: name.endsWith(".mp3") ? name : `${name}.mp3`, ext: "mp3" });
    }

    const { ext, zip } = await convertUploaded(inPath, file.name, id, output);
    return NextResponse.json({ id, filename: convertOutName(file.name, output, zip), ext });
  } catch (err) {
    try { await cleanupConvert(id); } catch { /* best-effort */ }
    const msg = err instanceof Error ? err.message : String(err);
    const friendly = /password|encrypt/i.test(msg) ? "This PDF is protected and can't be converted." : msg;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
