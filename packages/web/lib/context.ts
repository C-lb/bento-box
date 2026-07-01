import { parseOfficeAsync } from "officeparser";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";

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

const STASH_DIR = resolve("data/uploads/context");

export async function stashContext(buffer: Buffer, ext: ContextExt): Promise<string> {
  const id = randomUUID();
  await mkdir(STASH_DIR, { recursive: true });
  const text = await parseContextFile(buffer, ext);
  await writeFile(resolve(STASH_DIR, `${id}.json`), JSON.stringify({ ext, text }), "utf8");
  return id;
}

export async function readStash(contextId: string): Promise<{ ext: ContextExt; text: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(contextId)) return null;
  try {
    const raw = await readFile(resolve(STASH_DIR, `${contextId}.json`), "utf8");
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
    .set({ contextText: stash.text, contextFilePath: `data/uploads/context/${contextId}.json`, updatedAt: Date.now() })
    .where(eq(transcriptions.id, id))
    .run();
  return true;
}
