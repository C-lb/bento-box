import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mergePdfs, splitPdf, resavePdf, zipFiles } from "@/lib/pdf";
import type { StepAdapter } from "../types";
import type { FileRef, FilesRef } from "../StepIO";

export interface PdfParams {
  mode: "merge" | "split" | "compress";
  ranges?: number[][];
}

export const pdfStep: StepAdapter<FileRef | FilesRef, PdfParams, FileRef> = {
  inputKind: "file", // "files" also accepted at runtime for merge mode; the engine
  outputKind: "file", // passes whichever payload the prior step produced.
  paramsSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["merge", "split", "compress"] },
      ranges: { type: "array", items: { type: "array", items: { type: "integer" } } },
    },
    required: ["mode"],
    additionalProperties: false,
  },
  async run(input, params) {
    const refs: FileRef[] = "files" in input ? input.files : [input];
    const buffers = await Promise.all(refs.map((r) => readFile(r.path)));
    const dir = dirname(refs[0].path);
    if (params.mode === "merge") {
      const data = await mergePdfs(buffers);
      const outPath = join(dir, "merged.pdf");
      await writeFile(outPath, data);
      return { path: outPath, filename: "merged.pdf" };
    }
    if (params.mode === "compress") {
      const data = await resavePdf(buffers[0]);
      const outFilename = `${refs[0].filename.replace(/\.pdf$/i, "")}-compressed.pdf`;
      const outPath = join(dir, outFilename);
      await writeFile(outPath, data);
      return { path: outPath, filename: outFilename };
    }
    // split: zip the resulting files into a single downloadable output so the
    // adapter's outputKind stays "file" for every mode (matches the compat
    // table in lib/workflow/compat.ts, which grants pdf only "file" out).
    const files = await splitPdf(buffers[0], params.ranges ?? [], { single: false });
    const zipped = await zipFiles(files);
    const outPath = join(dir, "split.zip");
    await writeFile(outPath, zipped);
    return { path: outPath, filename: "split.zip" };
  },
};
