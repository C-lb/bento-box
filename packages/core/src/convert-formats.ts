export type ConvertCategory = "image" | "heic" | "pdf" | "audio";
export type OutputFormat = "png" | "jpg" | "webp" | "pdf" | "mp3" | "wav" | "m4a";

const EXT_CATEGORY: Record<string, ConvertCategory> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image",
  heic: "heic", heif: "heic",
  pdf: "pdf",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", flac: "audio",
  ogg: "audio", opus: "audio", mp4: "audio", mov: "audio", mkv: "audio",
  webm: "audio", avi: "audio", m4v: "audio",
};

const OUTPUTS: Record<ConvertCategory, OutputFormat[]> = {
  image: ["png", "jpg", "webp", "pdf"],
  heic: ["png", "jpg", "pdf"],
  pdf: ["png", "jpg"],
  audio: ["mp3", "wav", "m4a"],
};

const AUDIO_OUTPUTS = new Set<OutputFormat>(["mp3", "wav", "m4a"]);

function extname(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function basename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function categoryForFile(filename: string): ConvertCategory | null {
  return EXT_CATEGORY[extname(filename)] ?? null;
}

// Every extension the file-conversion path recognizes, in declaration order
// (used to build the file picker's `accept` list).
export function inputExtensions(): string[] {
  return Object.keys(EXT_CATEGORY);
}

export function outputsFor(category: ConvertCategory): OutputFormat[] {
  return OUTPUTS[category];
}

export function isValidConversion(filename: string, output: OutputFormat): boolean {
  const cat = categoryForFile(filename);
  return cat !== null && OUTPUTS[cat].includes(output);
}

export function extFor(output: OutputFormat): string {
  return output; // jpg/png/webp/pdf/mp3/wav/m4a all equal their extension
}

export function isAudioOutput(output: OutputFormat): boolean {
  return AUDIO_OUTPUTS.has(output);
}

export function convertOutName(srcName: string, output: OutputFormat, zip: boolean): string {
  const base = basename(srcName) || "file";
  return zip ? `${base}-pages.zip` : `${base}.${extFor(output)}`;
}
