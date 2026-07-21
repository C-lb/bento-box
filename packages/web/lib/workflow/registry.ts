import { resizeStep } from "./steps/resize";
import { heicStep } from "./steps/heic";
import { convertStep } from "./steps/convert";
import { pdfStep } from "./steps/pdf";
import { videoStep } from "./steps/video";
import { spliceStep } from "./steps/splice";
import { sliceStep } from "./steps/slice";
import { shortenStep } from "./steps/shorten";
import { qrStep } from "./steps/qr";
import { sorterStep } from "./steps/sorter";
import { transcribeStep } from "./steps/transcribe";
import { studioStep } from "./steps/studio";
import type { StepAdapter } from "./types";

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
