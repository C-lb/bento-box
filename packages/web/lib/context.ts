import { parseOfficeAsync } from "officeparser";

export type ContextExt = "md" | "markdown" | "html" | "pdf" | "pptx";

const EXTS: ContextExt[] = ["md", "markdown", "html", "pdf", "pptx"];

export function extFromName(filename: string): ContextExt | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return (EXTS as string[]).includes(ext) ? (ext as ContextExt) : null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
};

export function stripMarkup(input: string): string {
  let s = input.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&#?\w+;/g, (m) => ENTITIES[m] ?? " ");
  // Markdown markers: headings, emphasis, inline code, list bullets.
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/(\*\*|__|\*|_|`)/g, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export async function parseContextFile(buffer: Buffer, ext: ContextExt): Promise<string> {
  if (ext === "md" || ext === "markdown" || ext === "html") {
    return stripMarkup(buffer.toString("utf8"));
  }
  // pdf, pptx: officeparser returns extracted plain text.
  const text = await parseOfficeAsync(buffer);
  return stripMarkup(text);
}
