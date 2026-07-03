import { Readable } from "node:stream";
import type { drive_v3 } from "googleapis";

export interface DriveImage {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink: string | null;
}
export interface DriveFolder {
  id: string;
  name: string;
}
export interface DrivePresentation {
  id: string;
  name: string;
}
export interface DriveClient {
  listFolders(): Promise<DriveFolder[]>;
  listImages(folderId: string): Promise<DriveImage[]>;
  downloadThumbnail(image: DriveImage): Promise<Buffer | null>;
  downloadFile(fileId: string): Promise<Buffer>;
  thumbnailFor(fileId: string): Promise<Buffer | null>;
  listPresentations(folderId: string): Promise<DrivePresentation[]>;
  uploadPdf(name: string, bytes: Uint8Array, folderId: string): Promise<{ id: string; url: string }>;
  uploadFile(name: string, bytes: Uint8Array, mimeType: string, folderId: string): Promise<{ id: string; url: string }>;
}

export function makeDriveClient(drive: drive_v3.Drive): DriveClient {
  return {
    async listFolders() {
      const res = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: "files(id,name)",
        orderBy: "name",
        pageSize: 100,
      });
      return (res.data.files ?? [])
        .filter((f): f is typeof f & { id: string } => !!f.id)
        .map((f) => ({ id: f.id, name: f.name ?? "(untitled)" }));
    },
    async listImages(folderId: string) {
      const out: DriveImage[] = [];
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
          fields: "nextPageToken, files(id,name,mimeType,thumbnailLink)",
          pageSize: 100,
          pageToken,
        });
        for (const f of res.data.files ?? []) {
          if (!f.id) continue;
          out.push({
            id: f.id,
            name: f.name ?? "(untitled)",
            mimeType: f.mimeType ?? "application/octet-stream",
            thumbnailLink: f.thumbnailLink ?? null,
          });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    },
    async downloadThumbnail(image: DriveImage) {
      if (!image.thumbnailLink) return null;
      try {
        // drive client shares the OAuth2 auth; reuse its request to carry credentials
        const res = await (drive.context._options.auth as any).request({
          url: image.thumbnailLink,
          responseType: "arraybuffer",
        });
        return Buffer.from(res.data as ArrayBuffer);
      } catch {
        return null;
      }
    },
    async downloadFile(fileId: string) {
      const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
      return Buffer.from(res.data as ArrayBuffer);
    },
    async thumbnailFor(fileId: string) {
      const meta = await drive.files.get({ fileId, fields: "thumbnailLink" });
      const link = meta.data.thumbnailLink;
      if (!link) return null;
      try {
        const res = await (drive.context._options.auth as any).request({
          url: link,
          responseType: "arraybuffer",
        });
        return Buffer.from(res.data as ArrayBuffer);
      } catch {
        return null;
      }
    },
    async listPresentations(folderId: string) {
      const out: DrivePresentation[] = [];
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation' and trashed=false`,
          fields: "nextPageToken, files(id,name)",
          pageSize: 100,
          pageToken,
        });
        for (const f of res.data.files ?? []) {
          if (f.id) out.push({ id: f.id, name: f.name ?? "(untitled)" });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    },
    async uploadPdf(name: string, bytes: Uint8Array, folderId: string) {
      const res = await drive.files.create({
        requestBody: { name, parents: folderId ? [folderId] : undefined },
        media: { mimeType: "application/pdf", body: Readable.from(Buffer.from(bytes)) },
        fields: "id, webViewLink",
      });
      const id = res.data.id;
      if (!id) throw new Error("Drive did not return a file id");
      return { id, url: res.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view` };
    },
    async uploadFile(name: string, bytes: Uint8Array, mimeType: string, folderId: string) {
      const res = await drive.files.create({
        requestBody: { name, parents: folderId ? [folderId] : undefined },
        media: { mimeType, body: Readable.from(Buffer.from(bytes)) },
        fields: "id, webViewLink",
      });
      const id = res.data.id;
      if (!id) throw new Error("Drive did not return a file id");
      return { id, url: res.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view` };
    },
  };
}
