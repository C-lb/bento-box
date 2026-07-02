import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import JSZip from "jszip";
import { slideTextFromXml, slideNumberFromPath, orderSlidePaths, type SlideText } from "@event-editor/core/pptx";

/** Likely soffice locations for the current platform, with an env override first. */
export function sofficeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const list: string[] = [];
  if (env.EE_SOFFICE_PATH) list.push(env.EE_SOFFICE_PATH);
  if (platform === "darwin") {
    list.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  } else if (platform === "win32") {
    list.push(
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    );
  } else {
    list.push("/usr/bin/soffice", "/usr/local/bin/soffice", "/snap/bin/libreoffice");
  }
  return list;
}

export function resolveSofficePath(candidates: string[], exists: (p: string) => boolean): string | null {
  return candidates.find((p) => exists(p)) ?? null;
}

export function findSoffice(): string | null {
  return resolveSofficePath(sofficeCandidates(process.platform, process.env), existsSync);
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`soffice exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Convert a .pptx to PDF via LibreOffice headless. Returns the output PDF path. */
export async function convertToPdf(pptxPath: string, outDir: string): Promise<string> {
  const soffice = findSoffice();
  if (!soffice) throw new Error("LibreOffice (soffice) not found. Install it to slice slides.");
  await run(soffice, ["--headless", "--convert-to", "pdf", "--outdir", outDir, pptxPath]);
  const pdfName = basename(pptxPath).replace(/\.pptx$/i, ".pdf");
  const pdfPath = join(outDir, pdfName);
  if (!existsSync(pdfPath)) throw new Error("LibreOffice did not produce a PDF.");
  return pdfPath;
}

/** Extract per-slide text and speaker notes from a .pptx, in slide order. */
export async function readSlides(pptxPath: string): Promise<SlideText[]> {
  const buf = await readFile(pptxPath);
  const zip = await JSZip.loadAsync(buf);
  const slidePaths = orderSlidePaths(
    Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)),
  );
  const out: SlideText[] = [];
  for (const p of slidePaths) {
    const idx = slideNumberFromPath(p)!;
    const slideXml = await zip.files[p].async("string");
    const notesPath = `ppt/notesSlides/notesSlide${idx}.xml`;
    const notesXml = zip.files[notesPath] ? await zip.files[notesPath].async("string") : "";
    out.push({ index: idx, text: slideTextFromXml(slideXml), notes: notesXml ? slideTextFromXml(notesXml) : "" });
  }
  return out;
}
