import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

export async function mergePdfs(buffers: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return Buffer.from(await out.save({ useObjectStreams: true }));
}

export async function splitPdf(
  buffer: Buffer,
  ranges: number[][],
  opts: { single: boolean },
): Promise<{ name: string; data: Buffer }[]> {
  const src = await PDFDocument.load(buffer);
  if (opts.single) {
    const out = await PDFDocument.create();
    const flat = ranges.flat();
    const pages = await out.copyPages(src, flat);
    for (const p of pages) out.addPage(p);
    return [{ name: "selected.pdf", data: Buffer.from(await out.save()) }];
  }
  const files: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, ranges[i]);
    for (const p of pages) out.addPage(p);
    files.push({ name: `part-${i + 1}.pdf`, data: Buffer.from(await out.save()) });
  }
  return files;
}

export async function resavePdf(buffer: Buffer): Promise<Buffer> {
  const src = await PDFDocument.load(buffer);
  return Buffer.from(await src.save({ useObjectStreams: true }));
}

export async function pageCount(buffer: Buffer): Promise<number> {
  return (await PDFDocument.load(buffer)).getPageCount();
}

export async function zipFiles(files: { name: string; data: Buffer }[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.data);
  return zip.generateAsync({ type: "nodebuffer" });
}
