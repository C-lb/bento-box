import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { resizeImage } from "@/lib/resize";
import type { ResizeFormat } from "@event-editor/core/resize";
import type { StepAdapter } from "../types.js";
import type { FileRef } from "../StepIO.js";

export interface ResizeParams {
  maxW: number | null;
  maxH: number | null;
  format: ResizeFormat;
  quality: number;
}

export const resizeStep: StepAdapter<FileRef, ResizeParams, FileRef> = {
  inputKind: "file",
  outputKind: "file",
  paramsSchema: {
    type: "object",
    properties: {
      maxW: { type: ["integer", "null"] },
      maxH: { type: ["integer", "null"] },
      // Real ResizeFormat (packages/core/src/resize.ts) is "keep"|"jpg"|"png"|"webp" —
      // note "jpg" not "jpeg", and "keep" preserves the source format.
      format: { type: "string", enum: ["keep", "jpg", "png", "webp"] },
      quality: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["maxW", "maxH", "format", "quality"],
    additionalProperties: false,
  },
  async run(input, params) {
    const buf = await readFile(input.path);
    const { data, ext } = await resizeImage(buf, params, input.filename);
    const base = basename(input.filename, extname(input.filename));
    const outFilename = `${base}-resized.${ext}`;
    const outPath = join(dirname(input.path), outFilename);
    await writeFile(outPath, data);
    return { path: outPath, filename: outFilename };
  },
};
