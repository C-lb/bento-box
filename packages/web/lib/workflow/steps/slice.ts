import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { convertToPdf, readSlides, findSoffice } from "@/lib/pptx-convert";
import { pdfPageCount, buildOutputs } from "@/lib/pdf-slice";
import { planSlices, type GroupInput } from "@event-editor/core/slice-plan";
import { visionClient, segmentSpeakers, segmentByTopic } from "@/lib/anthropic";
import { runDir, newRunId, deckPath, masterPdfPath, outDir } from "@/lib/slice";
import type { StepAdapter } from "../types";
import type { FileRef, FilesRef } from "../StepIO";

export interface SliceParams {
  by: "range" | "speaker" | "topic";
  confidential: boolean;
  watermarkText: string;
  // Only used when by === "range": the manual group definitions the "manual"
  // mode of app/slice/SliceClient.tsx lets a user type directly (label + a
  // "1-3, 5" page-range string), bypassing AI segmentation entirely. Not in
  // the brief's original params table (which only covered the AI-segmented
  // "speaker"/"topic" paths) — added because "range" mode has no other way
  // to supply which pages go in which output.
  groups?: GroupInput[];
}

// Reuses the exact convert -> segment -> export sequence the /api/slice/*
// routes already run (see app/api/slice/{convert,segment,export}/route.ts),
// just called directly instead of over three HTTP round-trips.
export const sliceStep: StepAdapter<FileRef, SliceParams, FilesRef> = {
  inputKind: "file",
  outputKind: "files",
  paramsSchema: {
    type: "object",
    properties: {
      by: { type: "string", enum: ["range", "speaker", "topic"] },
      confidential: { type: "boolean" },
      watermarkText: { type: "string" },
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string" }, ranges: { type: "string" } },
          required: ["label", "ranges"],
        },
      },
    },
    required: ["by", "confidential", "watermarkText"],
    additionalProperties: false,
  },
  async run(input, params) {
    if (!findSoffice()) throw new Error("LibreOffice (soffice) is required to slice a deck and isn't installed.");

    const runId = newRunId();
    const dir = runDir(runId);
    await mkdir(dir, { recursive: true });

    // deckPath(runId) is always "deck.pptx" inside the run dir — convertToPdf
    // derives its output name from the input's basename, so the pptx MUST be
    // copied there (not to input.filename) for the resulting PDF to land at
    // masterPdfPath(runId) ("deck.pdf"), which is a fixed name, not derived
    // from the source filename. (Corrected vs. an earlier planning pass,
    // which copied to `input.filename` and would silently look for the wrong
    // PDF path whenever the upload wasn't literally named "deck.pptx".)
    const pptxPath = deckPath(runId);
    await writeFile(pptxPath, await readFile(input.path));
    await convertToPdf(pptxPath, dir);

    const master = await readFile(masterPdfPath(runId));
    const slides = await readSlides(pptxPath);
    const pageCount = await pdfPageCount(master);

    // segmentSpeakers/segmentByTopic return SpeakerGroup[] ({speaker,
    // startSlide, endSlide}), not the GroupInput[] ({label, ranges}) shape
    // planSlices expects — they are different types. The conversion below
    // mirrors app/slice/SliceClient.tsx's own mapping exactly. (Corrected vs.
    // an earlier planning pass, which fed the AI's SpeakerGroup[] straight
    // into planSlices.)
    let groups: GroupInput[];
    if (params.by === "range") {
      if (!params.groups || params.groups.length === 0) {
        throw new Error("Slice by range requires at least one group with a page range.");
      }
      groups = params.groups;
    } else {
      const client = visionClient();
      const speakerGroups =
        params.by === "topic" ? await segmentByTopic(client, slides) : await segmentSpeakers(client, slides);
      groups = speakerGroups.map((g) => ({
        label: g.speaker,
        ranges: g.startSlide === g.endSlide ? `${g.startSlide}` : `${g.startSlide}-${g.endSlide}`,
      }));
    }

    const plan = planSlices(groups, pageCount);
    if (plan.groups.length === 0) throw new Error("No exportable portions.");

    const outputs = await buildOutputs(master, plan.groups, {
      confidential: params.confidential,
      watermarkText: params.watermarkText,
    });

    const outputDir = outDir(runId);
    await mkdir(outputDir, { recursive: true });
    const files: FileRef[] = [];
    for (const o of outputs) {
      const outPath = join(outputDir, o.filename);
      await writeFile(outPath, Buffer.from(o.bytes));
      files.push({ path: outPath, filename: o.filename });
    }
    return { files };
  },
};
