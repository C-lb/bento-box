import { Readable } from "node:stream";
import type { drive_v3 } from "googleapis";

export async function createGoogleDoc(
  drive: drive_v3.Drive,
  html: string,
  name: string,
): Promise<{ id: string; url: string }> {
  const res = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.document" },
    media: { mimeType: "text/html", body: Readable.from(html) },
    fields: "id, webViewLink",
  });
  const id = res.data.id;
  if (!id) throw new Error("Drive did not return a document id");
  return { id, url: res.data.webViewLink ?? `https://docs.google.com/document/d/${id}/edit` };
}
