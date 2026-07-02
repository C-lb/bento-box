export type Tone = "idle" | "active" | "success" | "error";
export interface StatusView {
  tone: Tone;
  label: string;
}

export function jobStatusView(status: string): StatusView {
  switch (status) {
    case "scanning": return { tone: "active", label: "Scanning folder" };
    case "heuristics": return { tone: "active", label: "Checking image quality" };
    case "ranking": return { tone: "active", label: "Scoring with Claude" };
    case "done": return { tone: "success", label: "Done" };
    case "error": return { tone: "error", label: "Scan failed" };
    default: return { tone: "idle", label: status };
  }
}

export function transcriptionStatusView(status: string): StatusView {
  switch (status) {
    case "uploading": return { tone: "active", label: "Uploading" };
    case "transcribing": return { tone: "active", label: "Transcribing audio" };
    case "summarizing": return { tone: "active", label: "Summarizing with Claude" };
    case "creating_doc": return { tone: "active", label: "Creating the Google Doc" };
    case "done": return { tone: "success", label: "Done" };
    case "error": return { tone: "error", label: "Transcription failed" };
    default: return { tone: "idle", label: status };
  }
}

export function headshotStatusView(status: string): StatusView {
  switch (status) {
    case "rendering": return { tone: "active", label: "Rendering" };
    case "autofilling": return { tone: "active", label: "Filling Canva template" };
    case "exporting": return { tone: "active", label: "Exporting from Canva" };
    case "done": return { tone: "success", label: "Done" };
    case "error": return { tone: "error", label: "Render failed" };
    default: return { tone: "idle", label: status };
  }
}

export function sliceStatusView(status: string): StatusView {
  switch (status) {
    case "converting": return { tone: "active", label: "Converting with LibreOffice" };
    case "reading": return { tone: "active", label: "Reading slides" };
    case "segmenting": return { tone: "active", label: "Finding speaker portions" };
    case "exporting": return { tone: "active", label: "Building PDFs" };
    case "saving": return { tone: "active", label: "Saving to Drive" };
    case "done": return { tone: "success", label: "Done" };
    case "error": return { tone: "error", label: "Slicing failed" };
    default: return { tone: "idle", label: status };
  }
}
