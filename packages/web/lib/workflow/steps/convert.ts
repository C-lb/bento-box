import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { newConvertId, convertDir } from "@/lib/convert";
import { convertUploaded } from "@/lib/convert-file";
import type { OutputFormat } from "@event-editor/core/convert-formats";
import type { StepAdapter } from "../types.js";
import type { FileRef } from "../StepIO.js";

export interface ConvertParams {
  output: OutputFormat;
}

// Corrected vs. an earlier planning pass: `convertDir`/`newConvertId` live in
// `lib/convert.ts` (not `convert-file.ts`), and `convertUploaded` always writes
// its result as `out.<ext>` in that dir (see app/api/convert/file/route.ts) —
// never `<original-base>.<ext>`.
export const convertStep: StepAdapter<FileRef, ConvertParams, FileRef> = {
  inputKind: "file",
  outputKind: "file",
  paramsSchema: {
    type: "object",
    properties: { output: { type: "string", enum: ["png", "jpg", "webp", "pdf", "mp3", "wav", "m4a", "html"] } },
    required: ["output"],
    additionalProperties: false,
  },
  async run(input, params) {
    const id = newConvertId();
    const dir = convertDir(id);
    await mkdir(dir, { recursive: true });
    const inPath = join(dir, input.filename);
    await copyFile(input.path, inPath);
    const { ext } = await convertUploaded(inPath, input.filename, id, params.output);
    const outFilename = `out.${ext}`;
    return { path: join(dir, outFilename), filename: outFilename };
  },
};
