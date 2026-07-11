/** Background/logo upload intake for the F3 custom canvas editor. */
import { PDFDocument } from "pdf-lib";
import { pageSizeFromImage } from "@event-editor/core/custom-design";
import type { PageSize } from "@event-editor/core/merge";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type BackgroundKind = "png" | "jpg" | "pdf";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** src convention consumed by customDesignToSpec + the renderer:
 * data URL for images (usable by <img> and embedPng/embedJpg),
 * plain base64 for pdf (usable by embedPdf). */
export function assetSrc(kind: BackgroundKind, bytes: Uint8Array): string {
  const b64 = toBase64(bytes);
  if (kind === "pdf") return b64;
  return `data:image/${kind === "jpg" ? "jpeg" : "png"};base64,${b64}`;
}

function kindOf(file: File): BackgroundKind | undefined {
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "application/pdf") return "pdf";
  return undefined;
}

export async function readBackgroundUpload(
  file: File,
): Promise<{ kind: BackgroundKind; bytes: Uint8Array; page: PageSize }> {
  const kind = kindOf(file);
  if (!kind) throw new Error("Use a PNG, JPG or single-page PDF.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Background is over 15MB. Export a smaller file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === "pdf") {
    const doc = await PDFDocument.load(bytes);
    if (doc.getPageCount() !== 1) throw new Error("PDF backgrounds must be a single page.");
    const { width, height } = doc.getPage(0).getSize();
    return { kind, bytes, page: { width, height } };
  }
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: file.type }));
  try {
    return { kind, bytes, page: pageSizeFromImage(bmp.width, bmp.height) };
  } finally {
    bmp.close();
  }
}

/** Logos are normalised to PNG so the renderer's embedPng path covers all of them. */
export async function readLogoUpload(file: File): Promise<Uint8Array> {
  const kind = kindOf(file);
  if (kind !== "png" && kind !== "jpg") throw new Error("Use a PNG or JPG logo.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Logo is over 15MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === "png") return bytes;
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: file.type }));
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not read the logo image.");
  return new Uint8Array(await blob.arrayBuffer());
}
