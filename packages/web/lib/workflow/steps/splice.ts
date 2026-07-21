import { dirname, join } from "node:path";
import { spliceClips } from "@/lib/splice";
import { spliceOutName, type Clip, type SpliceKind, type SpliceScale } from "@event-editor/core/splice";
import type { StepAdapter } from "../types.js";
import type { FileRef, FilesRef } from "../StepIO.js";

export interface SpliceParams {
  kind: SpliceKind;
  scale: SpliceScale;
  clips: Clip[];
}

export const spliceStep: StepAdapter<FilesRef, SpliceParams, FileRef> = {
  inputKind: "files",
  outputKind: "file",
  paramsSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["video", "audio"] },
      scale: { type: "string", enum: ["match", "1080", "720"] },
      clips: { type: "array" },
    },
    required: ["kind", "scale", "clips"],
    additionalProperties: false,
  },
  async run(input, params) {
    // spliceOutName (packages/core/src/splice.ts) picks "joined.mp4" for video
    // vs "joined.m4a" for audio — the same rule app/api/splice/route.ts uses.
    const outFilename = spliceOutName(params.kind);
    const outPath = join(dirname(input.files[0].path), outFilename);
    await spliceClips(input.files.map((f) => f.path), outPath, params.clips, params);
    return { path: outPath, filename: outFilename };
  },
};
