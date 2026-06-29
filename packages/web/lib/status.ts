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
    case "done": return { tone: "success", label: "Done" };
    case "error": return { tone: "error", label: "Render failed" };
    default: return { tone: "idle", label: status };
  }
}
