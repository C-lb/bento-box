import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { heicToImage } from "@/lib/heic";
import type { HeicOpts } from "@event-editor/core/heic";
import type { StepAdapter } from "../types";
import type { FileRef } from "../StepIO";

export const heicStep: StepAdapter<FileRef, HeicOpts, FileRef> = {
  inputKind: "file",
  outputKind: "file",
  paramsSchema: {
    type: "object",
    properties: {
      // Real HeicFormat (packages/core/src/heic.ts) is "jpg"|"png" — not "jpeg".
      format: { type: "string", enum: ["png", "jpg"] },
      quality: { type: "integer", minimum: 1, maximum: 100 },
      saturation: { type: "number" },
      brightness: { type: "number" },
      haze: { type: "number" },
    },
    required: ["format", "quality", "saturation", "brightness", "haze"],
    additionalProperties: false,
  },
  async run(input, params) {
    const buf = await readFile(input.path);
    const data = await heicToImage(buf, params);
    const base = basename(input.filename, extname(input.filename));
    const outFilename = `${base}.${params.format}`;
    const outPath = join(dirname(input.path), outFilename);
    await writeFile(outPath, data);
    return { path: outPath, filename: outFilename };
  },
};
