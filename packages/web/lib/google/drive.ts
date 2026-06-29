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
export interface DriveClient {
  listFolders(): Promise<DriveFolder[]>;
  listImages(folderId: string): Promise<DriveImage[]>;
  downloadThumbnail(image: DriveImage): Promise<Buffer | null>;
  downloadFile(fileId: string): Promise<Buffer>;
  thumbnailFor(fileId: string): Promise<Buffer | null>;
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
  };
}
