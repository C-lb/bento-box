import { parseOfficeAsync } from "officeparser";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import { dataRoot } from "./jobs";

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

export type DocumentExt = "txt" | "md" | "markdown" | "html" | "pdf" | "docx" | "pptx";

export const DOCUMENT_EXTS: DocumentExt[] = ["txt", "md", "markdown", "html", "pdf", "docx", "pptx"];

/** A half-read document produces a confident wrong summary, so anything over
 *  this is an error rather than a truncation. Roughly 100k tokens. */
export const MAX_DOC_CHARS = 400_000;

/** Both input shapes (dragged file, exported Google Doc) go through this, so
 *  the cap cannot be bypassed by whichever path skips extractDocumentText. */
export function assertDocumentLength(text: string): void {
  if (text.length > MAX_DOC_CHARS) {
    throw new Error(
      `This document is too long to summarise in one pass (${text.length.toLocaleString()} characters, limit ${MAX_DOC_CHARS.toLocaleString()}).`,
    );
  }
}

export function documentExtFromName(filename: string): DocumentExt | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return (DOCUMENT_EXTS as string[]).includes(ext) ? (ext as DocumentExt) : null;
}

export async function extractDocumentText(buffer: Buffer, ext: DocumentExt): Promise<string> {
  let text: string;
  if (ext === "txt") {
    text = buffer.toString("utf8").trim();
  } else if (ext === "md" || ext === "markdown" || ext === "html") {
    text = stripMarkup(buffer.toString("utf8"));
  } else {
    // pdf, docx, pptx: officeparser returns extracted plain text.
    text = stripMarkup(await parseOfficeAsync(buffer));
  }
  if (!text.trim()) {
    throw new Error(
      ext === "pdf"
        ? "No text found in this PDF, it may be scanned images."
        : "No text found in this document.",
    );
  }
  assertDocumentLength(text);
  return text;
}

// Function, not a module-level const: EE_DATA_DIR must be honoured at call
// time (the packaged app sets it; cwd there is inside the app bundle).
function stashDir(): string {
  return resolve(dataRoot(), "uploads/context");
}

export async function stashContext(buffer: Buffer, ext: ContextExt): Promise<string> {
  const id = randomUUID();
  await mkdir(stashDir(), { recursive: true });
  const text = await parseContextFile(buffer, ext);
  await writeFile(resolve(stashDir(), `${id}.json`), JSON.stringify({ ext, text }), "utf8");
  return id;
}

export async function readStash(contextId: string): Promise<{ ext: ContextExt; text: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(contextId)) return null;
  try {
    const raw = await readFile(resolve(stashDir(), `${contextId}.json`), "utf8");
    const obj = JSON.parse(raw);
    return { ext: obj.ext, text: obj.text };
  } catch {
    return null;
  }
}

export async function linkStash(db: any, id: number, contextId: string): Promise<boolean> {
  const stash = await readStash(contextId);
  if (!stash) return false;
  db.update(transcriptions)
    .set({ contextText: stash.text, contextFilePath: resolve(stashDir(), `${contextId}.json`), updatedAt: Date.now() })
    .where(eq(transcriptions.id, id))
    .run();
  return true;
}
