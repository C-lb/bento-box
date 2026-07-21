import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot, newJobId, sanitizeJobId } from "@/lib/jobs";
import { generateQrBuffer, type QrGenOpts } from "@/lib/qr-server";
import type { StepAdapter } from "../types.js";
import type { FileRef } from "../StepIO.js";

export const qrStep: StepAdapter<{ text: string }, QrGenOpts, FileRef> = {
  inputKind: "url-text",
  outputKind: "file",
  paramsSchema: {
    type: "object",
    properties: {
      size: { type: "integer", minimum: 128, maximum: 1024 },
      ecc: { type: "string", enum: ["L", "M", "Q", "H"] },
      fg: { type: "string" },
      bg: { type: "string" },
      format: { type: "string", enum: ["png", "svg"] },
    },
    required: ["size", "ecc", "fg", "bg", "format"],
    additionalProperties: false,
  },
  async run(input, params) {
    const buf = await generateQrBuffer(input.text, params);
    const id = sanitizeJobId(newJobId());
    const dir = join(dataRoot(), "qr", id);
    await mkdir(dir, { recursive: true });
    const filename = `qr.${params.format}`;
    const path = join(dir, filename);
    await writeFile(path, buf);
    return { path, filename };
  },
};
