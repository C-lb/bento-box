import { resizeStep } from "./steps/resize.js";
import { heicStep } from "./steps/heic.js";
import { convertStep } from "./steps/convert.js";
import { pdfStep } from "./steps/pdf.js";
import { videoStep } from "./steps/video.js";
import { spliceStep } from "./steps/splice.js";
import { sliceStep } from "./steps/slice.js";
import { shortenStep } from "./steps/shorten.js";
import { qrStep } from "./steps/qr.js";
import { sorterStep } from "./steps/sorter.js";
import { transcribeStep } from "./steps/transcribe.js";
import { studioStep } from "./steps/studio.js";
import type { StepAdapter } from "./types.js";

export const STEP_REGISTRY: Record<string, StepAdapter<any, any, any>> = {
  resize: resizeStep,
  heic: heicStep,
  convert: convertStep,
  pdf: pdfStep,
  video: videoStep,
  splice: spliceStep,
  slice: sliceStep,
  shorten: shortenStep,
  qr: qrStep,
  sorter: sorterStep,
  transcribe: transcribeStep,
  studio: studioStep,
};
