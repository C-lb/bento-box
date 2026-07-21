import { dirname, join } from "node:path";
import { compressVideo } from "@/lib/video";
import { videoOutName, type VideoScale } from "@event-editor/core/video";
import type { StepAdapter } from "../types.js";
import type { FileRef } from "../StepIO.js";

export interface VideoParams {
  crf: number;
  scale: VideoScale;
}

export const videoStep: StepAdapter<FileRef, VideoParams, FileRef> = {
  inputKind: "file",
  outputKind: "file",
  paramsSchema: {
    type: "object",
    properties: {
      crf: { type: "integer", minimum: 0, maximum: 51 },
      scale: { type: "string", enum: ["keep", "1080", "720"] },
    },
    required: ["crf", "scale"],
    additionalProperties: false,
  },
  async run(input, params) {
    // videoOutName (packages/core/src/video.ts) is the same naming rule
    // app/api/video/route.ts uses for its output filename.
    const outFilename = videoOutName(input.filename);
    const outPath = join(dirname(input.path), outFilename);
    await compressVideo(input.path, outPath, params);
    return { path: outPath, filename: outFilename };
  },
};
